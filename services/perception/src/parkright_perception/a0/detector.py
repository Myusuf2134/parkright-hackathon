"""Raw pixel detector boundary. TEST STUB implementations belong in tests only."""

from dataclasses import dataclass
from typing import Protocol

from PIL import Image


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    box: tuple[float, float, float, float]  # normalized xyxy, full image


@dataclass(frozen=True)
class BackgroundAnchor:
    x: float
    y: float
    confidence: float


@dataclass(frozen=True)
class DetectionResult:
    detections: tuple[Detection, ...]
    background: tuple[BackgroundAnchor, ...] = ()


class Detector(Protocol):
    identity: str

    def detect(self, image: Image.Image) -> DetectionResult: ...
