"""Evaluation — the ONLY place simulator ground truth is accepted.

Imported and mounted by create_app() only when evaluation is enabled. Stores into
its own GroundTruthStore; never touches FacilityState, the tracker or perception."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from parkright_contracts import CameraId, GroundTruthRecord, SessionId
from parkright_evaluation import GroundTruthStore

from ..deps import require_ingest_token

router = APIRouter(prefix="/evaluation", tags=["Evaluation (not production)"], dependencies=[Depends(require_ingest_token)])


def _store(request: Request) -> GroundTruthStore:
    return request.app.state.ground_truth


@router.post("/ground-truth", status_code=202, summary="Record simulator ground truth for a frame (never affects parking state)")
def record_ground_truth(request: Request, record: GroundTruthRecord) -> JSONResponse:
    _store(request).add(record)
    return JSONResponse({"recorded": True}, status_code=202)


@router.get("/ground-truth", response_model=list[GroundTruthRecord])
def list_ground_truth(
    request: Request,
    camera_id: Annotated[CameraId, Query()],
    session_id: Annotated[SessionId, Query()],
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> list[GroundTruthRecord]:
    return _store(request).list(camera_id, session_id, limit)
