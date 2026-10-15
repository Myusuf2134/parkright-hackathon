"""Camera Frame Contract v1 — THE boundary between any camera and the backend.

    POST /api/v1/cameras/{camera_id}/frames
    Authorization: Bearer <ingest token>
    Content-Type: multipart/form-data
      metadata — JSON, exactly FrameMetadata
      image    — the JPEG, Content-Type image/jpeg

A frame carries pixels and timing. Never occupancy, labels, vehicle positions,
simulator state or ground truth: FrameMetadata forbids extra keys and the
endpoint rejects any other multipart part.
"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from .ids import CameraId, SessionId, Timestamp
from .occupancy import ModelRef, OccupancyObservation

FRAME_CONTRACT_VERSION = 1
FRAME_METADATA_PART = "metadata"
FRAME_IMAGE_PART = "image"
FRAME_CONTENT_TYPE = "image/jpeg"
FRAME_MAX_BYTES = 2 * 1024 * 1024
"""Default upper bound for one JPEG. The API may be configured lower."""
FRAME_METADATA_MAX_BYTES = 4096

_MAX_INT = 2**53 - 1  # safe in JavaScript


class FrameMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: SessionId = Field(description="One run of this camera's stream. Change it whenever seq restarts.")
    camera_id: CameraId
    seq: StrictInt = Field(ge=0, le=_MAX_INT, description="Strictly increasing within (camera_id, session_id). Gaps allowed.")
    sim_time_ms: StrictInt = Field(ge=0, le=_MAX_INT, description="Simulation clock, ms. Non-decreasing within a session.")
    captured_at: Timestamp = Field(description="Wall-clock capture time. Used only for staleness, never for ordering.")


def looks_like_jpeg(data: bytes) -> bool:
    """JPEG files start with SOI + marker: FF D8 FF."""
    return len(data) >= 3 and data[:3] == b"\xff\xd8\xff"


class FrameOutcome(StrEnum):
    """
    accepted: new frame; perception ran; parking state updated.
    duplicate: same (camera, session, seq) already processed. Nothing done; safe to retry.
    out_of_order: seq lower than one already processed in this session. Dropped.
    stale: in order, but captured too long ago. seq recorded; state untouched.
    superseded_session: from a session this camera has since replaced. Dropped.
    """

    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    OUT_OF_ORDER = "out_of_order"
    STALE = "stale"
    SUPERSEDED_SESSION = "superseded_session"


class FrameIngestResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: FrameOutcome
    camera_id: CameraId
    session_id: SessionId
    seq: int
    observations: list[OccupancyObservation] = Field(description="Empty unless outcome is accepted.")
    model: ModelRef | None
    changed: int = Field(description="Spaces whose driver-visible state changed.")
    gap: int = Field(ge=0, description="seq values skipped since the previous processed frame.")
    detail: str | None
