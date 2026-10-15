"""Perception boundary:  Frame ─▶ PerceptionProvider ─▶ SpaceInference[]

A provider sees exactly one camera frame (JPEG bytes + timing metadata) and
the spaces that camera watches. It never sees ground truth, other cameras'
results, or parking state. A0 baseline, A1 augmentation, A2 simulator-adverse
and A3 Cosmos-synthetic arms are all just different providers.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from parkright_contracts import FrameMetadata, ModelRef, OccupancyState, Point


@dataclass(frozen=True, slots=True)
class Frame:
    """Everything a provider may know about a frame: its timing and its pixels."""

    metadata: FrameMetadata
    jpeg: bytes


@dataclass(frozen=True, slots=True)
class WatchedSpace:
    space_id: str
    polygon: tuple[Point, ...] | None
    """Outline in the camera image, normalised 0…1, origin top-left. None until calibrated."""


@dataclass(frozen=True, slots=True)
class CameraView:
    camera_id: str
    spaces: tuple[WatchedSpace, ...]


@dataclass(frozen=True, slots=True)
class SpaceInference:
    """One space as the provider sees it. The pipeline adds camera/frame/model provenance."""

    space_id: str
    state: OccupancyState
    confidence: float | None
    """The model's score for ``state``, or None if it has none. Never invent one."""


@runtime_checkable
class PerceptionProvider(Protocol):
    @property
    def model(self) -> ModelRef: ...

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]: ...
