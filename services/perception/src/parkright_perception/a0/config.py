from dataclasses import dataclass


@dataclass(frozen=True)
class A0Config:
    detector_min_score: float = 0.01
    detector_nms_iou: float = 0.5
    occupied_confidence: float = 0.65
    occupied_coverage: float = 0.45
    ambiguity_confidence: float = 0.05
    ambiguity_coverage: float = 0.02
    open_background_confidence: float = 0.995
    min_background_anchors: int = 16
    # Experimental: enable only after camera-specific false-OPEN evaluation.
    allow_open: bool = False
    min_dimension: int = 64
    max_pixels: int = 16_000_000
    min_roi_pixels: int = 256
    min_brightness: float = 18.0
    max_brightness: float = 240.0
    min_contrast: float = 5.0

    def __post_init__(self):
        if type(self.allow_open) is not bool:
            raise ValueError("allow_open must be a JSON boolean")
        if self.detector_min_score > self.ambiguity_confidence:
            raise ValueError("detector floor cannot discard ambiguity evidence")
        for name in (
            "detector_min_score",
            "detector_nms_iou",
            "occupied_confidence",
            "occupied_coverage",
            "ambiguity_confidence",
            "ambiguity_coverage",
            "open_background_confidence",
        ):
            if not 0 < getattr(self, name) <= 1:
                raise ValueError(f"{name} must be in (0, 1]")
        if self.ambiguity_confidence > self.occupied_confidence:
            raise ValueError("ambiguity threshold must not exceed occupied threshold")
        if self.ambiguity_coverage > self.occupied_coverage:
            raise ValueError("ambiguity coverage must not exceed occupied coverage")
        if self.open_background_confidence < 0.5:
            raise ValueError("OPEN confidence must meet canonical minimum")
        if not 0 <= self.min_brightness < self.max_brightness <= 255:
            raise ValueError("invalid brightness range")
        if (
            min(
                self.min_dimension,
                self.max_pixels,
                self.min_roi_pixels,
                self.min_background_anchors,
                self.min_contrast,
            )
            <= 0
        ):
            raise ValueError("quality limits must be positive")
