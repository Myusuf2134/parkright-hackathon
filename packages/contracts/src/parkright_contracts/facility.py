"""Facilities, levels and cameras — the configuration drivers browse."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .geometry import Point, Rect
from .ids import CameraId, FacilityId, LevelId, SpaceId, Timestamp
from .occupancy import OccupancyCounts, ParkingSpace, SpaceDesignation


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Level(_Model):
    level_id: LevelId
    facility_id: FacilityId
    name: str
    ordinal: int


class Camera(_Model):
    camera_id: CameraId
    facility_id: FacilityId
    level_id: LevelId
    name: str
    kind: Literal["virtual", "physical"]
    online: bool = Field(description="A frame arrived within the staleness window.")
    last_frame_at: Timestamp | None


class Facility(_Model):
    facility_id: FacilityId
    name: str
    address: str | None
    location: Point | None = Field(description="Only set for a real, surveyed location (x=longitude, y=latitude).")
    is_simulated: bool = Field(description="True for a virtual environment. Always label it as such.")
    levels: list[Level]
    cameras: list[Camera]
    counts: OccupancyCounts
    updated_at: Timestamp | None


class FacilityOccupancy(_Model):
    facility_id: FacilityId
    counts: OccupancyCounts
    spaces: list[ParkingSpace]
    generated_at: Timestamp


# ---- static facility configuration (packages/shared/fixtures/*.json) -------------------


class SpaceConfig(_Model):
    space_id: SpaceId
    level_id: LevelId
    designation: SpaceDesignation = SpaceDesignation.STANDARD
    plan: Rect = Field(description="Where the space sits on the level plan.")


class CameraConfig(_Model):
    camera_id: CameraId
    level_id: LevelId
    name: str
    kind: Literal["virtual", "physical"]
    watches: list[SpaceId] = Field(min_length=1)
    polygons: dict[SpaceId, list[Point]] = Field(
        default_factory=dict,
        description="Space outlines in this camera's image (calibration). Empty until the view is fixed.",
    )


class LevelConfig(_Model):
    level_id: LevelId
    name: str
    ordinal: int = 0


class FacilityConfig(_Model):
    facility_id: FacilityId
    name: str
    address: str | None = None
    is_simulated: bool
    levels: list[LevelConfig] = Field(min_length=1)
    spaces: list[SpaceConfig] = Field(min_length=1)
    cameras: list[CameraConfig] = Field(min_length=1)
