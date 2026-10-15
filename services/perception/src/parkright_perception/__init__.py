"""Frame → PerceptionProvider → OccupancyObservation[]. Never imports evaluation or ground truth."""

from .normalize import to_observations
from .provider import CameraView, Frame, PerceptionProvider, SpaceInference, WatchedSpace
from .registry import available_providers, create_provider

__all__ = [
    "CameraView",
    "Frame",
    "PerceptionProvider",
    "SpaceInference",
    "WatchedSpace",
    "available_providers",
    "create_provider",
    "to_observations",
]
