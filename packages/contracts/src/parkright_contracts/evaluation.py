"""Evaluation contracts. Simulator ground truth lives here and ONLY here.

It is for scoring perception (A0–A3), tests and debugging. It is sent to
/api/v1/evaluation/ground-truth and never handed to a PerceptionProvider.

The vocabulary is deliberately different from OccupancyState (lower-case
``occupied`` / ``empty``) so ground truth cannot be passed where an observation
is expected, or vice versa, without failing validation.
"""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .ids import CameraId, Identifier, SessionId, SpaceId


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EnvironmentPreset(_Strict):
    preset_id: Identifier
    name: str = Field(max_length=80)
    lighting: Literal["day", "dusk", "night"]
    weather: Literal["clear", "overcast", "rain", "fog", "snow"]
    intensity: float = Field(ge=0, le=1, description="0 = none, 1 = the most severe the simulator renders.")


class GroundTruthLabel(StrEnum):
    OCCUPIED = "occupied"
    EMPTY = "empty"


class GroundTruthSpace(_Strict):
    space_id: SpaceId
    truth: GroundTruthLabel


class GroundTruthRecord(_Strict):
    """What the simulator knows was true when it rendered frame ``seq``."""

    session_id: SessionId
    camera_id: CameraId
    seq: int = Field(ge=0)
    sim_time_ms: int = Field(ge=0)
    environment_preset: Identifier | None
    spaces: list[GroundTruthSpace] = Field(min_length=1, max_length=500)
