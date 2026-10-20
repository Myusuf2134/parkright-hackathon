import os
from pathlib import Path

from ..a0.config import A0Config
from ..a0.detector import Detector
from ..a0.provider import A0Provider
from .fasterrcnn import PROVIDER_NAME, FasterRCNNA2

DEFAULT_CHECKPOINT = Path.home() / ".cache/parkright/models/a2-fasterrcnn/best.pt"


class UnavailableA2:
    """Failure state only. Never returns detections or substitutes another model."""

    provider_name = PROVIDER_NAME
    identity = "a2-fasterrcnn-artifacts-unavailable"
    artifacts_available = False

    def __init__(self, reason: str):
        self.reason = reason

    def detect(self, image):
        raise RuntimeError(self.reason)


def from_environment() -> A0Provider:
    """Selected with PARKRIGHT_PERCEPTION_PROVIDER=a2.

    The calibrated space mapper and its thresholds are the A0 defaults, deliberately
    not overridable here: occupied 0.65, coverage 0.45, allow_open false.
    """
    checkpoint = Path(os.environ.get("PARKRIGHT_A2_CHECKPOINT") or DEFAULT_CHECKPOINT)
    detector: Detector
    try:
        detector = FasterRCNNA2(checkpoint, os.environ.get("PARKRIGHT_A2_DEVICE", "cpu"))
    except Exception as exc:
        detector = UnavailableA2(type(exc).__name__ + ": " + str(exc))
    return A0Provider(detector, A0Config())
