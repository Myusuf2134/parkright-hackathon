"""Occupancy: what perception concluded, and what a driver may be shown."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .ids import CameraId, FacilityId, LevelId, SessionId, SpaceId, Timestamp


class OccupancyState(StrEnum):
    """
    OPEN: the camera saw the space and it is empty.
    OCCUPIED: the camera saw a vehicle in the space.
    UNCERTAIN: anything else — no model, weak evidence, obstruction, stale data,
    camera silent. UNCERTAIN is never presented as availability.
    """

    OPEN = "OPEN"
    OCCUPIED = "OCCUPIED"
    UNCERTAIN = "UNCERTAIN"


MIN_OPEN_CONFIDENCE = 0.5
"""Below this confidence an OPEN observation is downgraded to UNCERTAIN."""

Confidence = float


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ModelRef(_Strict):
    """Which perception implementation produced an observation (e.g. A0 baseline, A3 Cosmos)."""

    provider: str = Field(min_length=1, max_length=64)
    version: str = Field(min_length=1, max_length=64)


class OccupancyObservation(_Strict):
    """One space, as inferred from one camera frame. Produced only by the perception pipeline."""

    space_id: SpaceId
    state: OccupancyState
    confidence: Confidence | None = Field(ge=0, le=1, description="The model's score for `state`, or null when no model scored it.")
    camera_id: CameraId
    session_id: SessionId
    frame_seq: int = Field(ge=0)
    sim_time_ms: int = Field(ge=0)
    captured_at: Timestamp
    model: ModelRef


def safe_state(state: OccupancyState, confidence: float | None) -> OccupancyState:
    """The state a driver may be shown. OPEN needs a measured confidence ≥ MIN_OPEN_CONFIDENCE;
    OCCUPIED needs a measured confidence at all. Everything else is UNCERTAIN."""
    if state is OccupancyState.OPEN and (confidence is None or confidence < MIN_OPEN_CONFIDENCE):
        return OccupancyState.UNCERTAIN
    if state is OccupancyState.OCCUPIED and confidence is None:
        return OccupancyState.UNCERTAIN
    return state


def is_confirmed_available(state: OccupancyState, stale: bool) -> bool:
    """The only predicate a driver UI should use to offer a space."""
    return state is OccupancyState.OPEN and not stale


class SpaceDesignation(StrEnum):
    """Who may legally park in a space. Drivers are only offered spaces they may use."""

    STANDARD = "standard"
    ACCESSIBLE = "accessible"
    EV = "ev"
    RESERVED = "reserved"


class ParkingSpace(_Strict):
    """Current belief about one space, as served to clients."""

    space_id: SpaceId
    facility_id: FacilityId
    level_id: LevelId
    designation: SpaceDesignation
    current_state: OccupancyState = Field(description="UNCERTAIN whenever evidence is missing, weak or stale.")
    confidence: Confidence | None = Field(ge=0, le=1)
    last_observed_at: Timestamp | None = Field(description="Server time of the last frame that observed this space. Null = never observed.")
    source_camera_id: CameraId | None
    stale: bool = Field(description="True when current_state is UNCERTAIN only because the evidence is too old.")
    frame_seq: int | None = Field(ge=0)
    model: ModelRef | None


class OccupancyCounts(_Strict):
    total: int
    open: int
    occupied: int
    uncertain: int


def count_states(states: list[OccupancyState]) -> OccupancyCounts:
    return OccupancyCounts(
        total=len(states),
        open=sum(s is OccupancyState.OPEN for s in states),
        occupied=sum(s is OccupancyState.OCCUPIED for s in states),
        uncertain=sum(s is OccupancyState.UNCERTAIN for s in states),
    )


class OccupancyChange(_Strict):
    space_id: SpaceId
    level_id: LevelId
    state: OccupancyState
    previous_state: OccupancyState
    confidence: Confidence | None
    source_camera_id: CameraId | None
    reason: Literal["observation", "stale"]


class FrameRef(_Strict):
    camera_id: CameraId
    session_id: SessionId
    seq: int
    received_at: Timestamp


class OccupancyUpdateMessage(_Strict):
    """Realtime: sent after every accepted frame (changes may be empty) and when evidence goes stale."""

    type: Literal["occupancy_update"] = "occupancy_update"
    facility_id: FacilityId
    changes: list[OccupancyChange]
    counts: OccupancyCounts
    frame: FrameRef | None = Field(description="The frame that caused this update; null for staleness.")
    published_at: Timestamp
