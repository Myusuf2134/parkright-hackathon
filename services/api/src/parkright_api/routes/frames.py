"""Frame ingestion — the production perception path.

    POST /api/v1/cameras/{camera_id}/frames   multipart: metadata (JSON) + image (JPEG)
      → validate → order (FrameStreamTracker) → PerceptionProvider → normalise
      → state → realtime

Only pixels and timing enter here. Any multipart part other than ``metadata`` and
``image`` is rejected and FrameMetadata forbids extra keys, so simulator ground
truth cannot ride along. This module must never import parkright_evaluation.
"""

import asyncio
import json
from collections import defaultdict
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from parkright_contracts import (
    FRAME_CONTENT_TYPE,
    FRAME_IMAGE_PART,
    FRAME_METADATA_MAX_BYTES,
    FRAME_METADATA_PART,
    CameraId,
    FrameIngestResult,
    FrameMetadata,
    FrameOutcome,
    FrameRef,
    OccupancyUpdateMessage,
    count_states,
    looks_like_jpeg,
)
from parkright_perception import CameraView, Frame, PerceptionProvider, WatchedSpace, to_observations

from ..deps import hub, now, registry, require_ingest_token, settings
from ..errors import ApiError, ErrorResponse

router = APIRouter(tags=["Cameras"])

_ALLOWED_PARTS = {FRAME_METADATA_PART, FRAME_IMAGE_PART}


def _bad(code: str, message: str, details: object = None) -> ApiError:
    return ApiError(400, code, message, details)


async def _read_parts(request: Request, max_bytes: int) -> tuple[FrameMetadata, bytes]:
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        raise ApiError(415, "unsupported_media_type", f"Send multipart/form-data with '{FRAME_METADATA_PART}' and '{FRAME_IMAGE_PART}' parts")
    form = await request.form(max_files=2, max_fields=4, max_part_size=FRAME_METADATA_MAX_BYTES)
    try:
        items = form.multi_items()
        unexpected = sorted({k for k, _ in items} - _ALLOWED_PARTS)
        if unexpected:
            raise _bad(
                "unexpected_part",
                f"Unexpected multipart part(s) {unexpected}. Only '{FRAME_METADATA_PART}' and '{FRAME_IMAGE_PART}' are accepted; "
                "ground truth goes to /api/v1/evaluation/ground-truth",
            )
        for key in _ALLOWED_PARTS:
            if len(form.getlist(key)) > 1:
                raise _bad("duplicate_part", f"Exactly one '{key}' part is allowed")

        raw = form.get(FRAME_METADATA_PART)
        if raw is None:
            raise _bad("missing_metadata", f"Missing '{FRAME_METADATA_PART}' part")
        if isinstance(raw, UploadFile):  # browsers send a JSON Blob as a file part
            data = await raw.read(FRAME_METADATA_MAX_BYTES + 1)
            if len(data) > FRAME_METADATA_MAX_BYTES:
                raise _bad("invalid_metadata", "metadata part is too large")
            raw = data.decode("utf-8", errors="replace")
        try:
            metadata = FrameMetadata.model_validate(json.loads(raw))
        except json.JSONDecodeError:
            raise _bad("invalid_metadata", "metadata is not valid JSON") from None
        except ValidationError as e:
            details = [{"path": ".".join(str(p) for p in err["loc"]), "message": err["msg"]} for err in e.errors()]
            raise _bad("invalid_metadata", "metadata does not match FrameMetadata", details) from None

        image = form.get(FRAME_IMAGE_PART)
        if image is None:
            raise _bad("missing_image", f"Missing '{FRAME_IMAGE_PART}' part")
        if not isinstance(image, UploadFile):
            raise _bad("missing_image", f"'{FRAME_IMAGE_PART}' must be a file part")
        mime = (image.content_type or "").split(";")[0].strip().lower()
        if mime != FRAME_CONTENT_TYPE:
            raise ApiError(415, "unsupported_media_type", f"image must be {FRAME_CONTENT_TYPE}, got {mime or 'nothing'}")
        jpeg = await image.read(max_bytes + 1)
        if len(jpeg) > max_bytes:
            raise ApiError(413, "payload_too_large", f"image exceeds {max_bytes} bytes")
        if not looks_like_jpeg(jpeg):
            raise ApiError(415, "unsupported_media_type", "image is not a JPEG")
        return metadata, jpeg
    finally:
        await form.close()


def _locks(request: Request) -> defaultdict[str, asyncio.Lock]:
    return request.app.state.camera_locks


@router.post(
    "/cameras/{camera_id}/frames",
    dependencies=[Depends(require_ingest_token)],
    response_model=FrameIngestResult,
    status_code=202,
    summary="Upload one camera frame (JPEG) for perception",
    description=(
        "multipart/form-data with exactly two parts: `metadata` (FrameMetadata JSON) and `image` (image/jpeg). "
        "Never send occupancy or ground truth here. 202 = processed; 200 = received but not processed "
        "(duplicate, out_of_order, stale, superseded_session) — see `outcome`."
    ),
    responses={200: {"model": FrameIngestResult}, **{c: {"model": ErrorResponse} for c in (400, 401, 404, 409, 413, 415, 503)}},
)
async def ingest_frame(request: Request, camera_id: Annotated[CameraId, Path()]) -> JSONResponse:
    received_at = now()
    facility = registry(request).for_camera(camera_id)
    camera = facility.camera(camera_id) if facility else None
    if facility is None or camera is None:
        raise ApiError(404, "unknown_camera", f'Camera "{camera_id}" is not registered')

    cfg = settings(request)
    metadata, jpeg = await _read_parts(request, cfg.frame_max_bytes)
    if metadata.camera_id != camera_id:
        raise _bad("camera_mismatch", f'metadata.camera_id "{metadata.camera_id}" does not match the URL')

    tracker = request.app.state.tracker
    provider: PerceptionProvider = request.app.state.perception
    base = {"camera_id": camera_id, "session_id": metadata.session_id, "seq": metadata.seq, "observations": [], "model": None, "changed": 0}

    async with _locks(request)[camera_id]:
        verdict = tracker.classify(metadata, received_at)
        if verdict.outcome == "rejected":
            raise ApiError(409, "sim_time_regressed", verdict.detail or "")
        if verdict.outcome is FrameOutcome.STALE:
            tracker.commit(metadata)
        if verdict.outcome is not FrameOutcome.ACCEPTED:
            body = FrameIngestResult(**base, outcome=verdict.outcome, gap=verdict.gap, detail=verdict.detail)
            return JSONResponse(body.model_dump(mode="json"), status_code=200)

        view = CameraView(
            camera_id=camera_id,
            spaces=tuple(WatchedSpace(space_id=s, polygon=tuple(camera.polygons[s]) if s in camera.polygons else None) for s in camera.watches),
        )
        try:
            raw = await asyncio.wait_for(provider.infer(Frame(metadata=metadata, jpeg=jpeg), view), cfg.perception_timeout_s)
        except TimeoutError:
            raise ApiError(503, "perception_timeout", f"Perception did not answer within {cfg.perception_timeout_s} s; frame not recorded, safe to retry") from None
        observations = to_observations(Frame(metadata=metadata, jpeg=jpeg), view, provider.model, raw)
        changes = facility.apply(observations, received_at)
        tracker.commit(metadata)

        spaces = facility.spaces(received_at)
        message = OccupancyUpdateMessage(
            facility_id=facility.facility_id,
            changes=changes,
            counts=count_states([s.current_state for s in spaces]),
            spaces=spaces,
            frame=FrameRef(camera_id=camera_id, session_id=metadata.session_id, seq=metadata.seq, received_at=received_at),
            published_at=now(),
        )
        hub(request).publish(facility.facility_id, message.model_dump_json())

    body = FrameIngestResult(**base | {"observations": observations, "model": provider.model, "changed": len(changes)}, outcome=FrameOutcome.ACCEPTED, gap=verdict.gap, detail=verdict.detail)
    return JSONResponse(body.model_dump(mode="json"), status_code=202)
