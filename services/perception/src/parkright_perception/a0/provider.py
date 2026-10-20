import asyncio
import hashlib
import io
import json
import logging
import math
import os
import threading
from dataclasses import asdict
from pathlib import Path
from time import perf_counter
from datetime import UTC, datetime

import numpy as np
from parkright_contracts import ModelRef, OccupancyState
from PIL import Image, ImageDraw, UnidentifiedImageError
from shapely.geometry import Point, Polygon, box

from ..provider import CameraView, Frame, SpaceInference
from .config import A0Config
from .detector import Detector

log = logging.getLogger(__name__)
VEHICLES = frozenset(("car", "truck", "bus", "suv", "van"))


class A0Provider:
    def __init__(self, detector: Detector, config: A0Config | None = None):
        config = config or A0Config()
        self.detector, self.config = detector, config
        fingerprint = hashlib.sha256(
            json.dumps(
                {"detector": detector.identity, "config": asdict(config)},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        self._model = ModelRef(
            provider="a0-test-stub"
            if detector.identity.startswith("TEST STUB")
            else "a0-nvidia-ssd300",
            version=f"1-{fingerprint[:32]}",
        )
        self.last_timings: dict[str, float] = {}
        self.last_error = None
        # Protect model init/inference, including requests continuing after API timeout.
        self._lock = threading.Lock()
        self._active: asyncio.Task[list[SpaceInference]] | None = None
        self._phase = "cold"
        self._warm = False
        self._loaded = False
        self._snapshot: dict = {}
        self.last_detections: list[dict] = []
        self._startup_ms: float | None = None

    def diagnostics(self):
        return {
            "phase": self._phase,
            "weights_available": getattr(self.detector, "artifacts_available", True),
            "model_loaded": self._loaded,
            "warmup_successful": self._warm,
            "inference_ready": self._phase in ("ready", "degraded")
            and self._warm
            and not (self._active and not self._active.done()),
            "startup_ms": self._startup_ms,
            "identity": self.detector.identity,
            "artifact_error": getattr(self.detector, "reason", None),
            "thresholds": asdict(self.config),
            **self._snapshot,
        }

    async def warmup(self):
        self._phase = "warming"
        start = perf_counter()
        try:
            await asyncio.to_thread(self._warmup_locked)
            self._loaded = self._warm = True
            self._phase = "ready"
        except Exception as exc:
            self._phase = "unavailable"
            self._snapshot = {"error": type(exc).__name__}
            log.exception("NVIDIA warm-up failed")
        self._startup_ms = (perf_counter() - start) * 1000

    def _warmup_locked(self):
        with self._lock:
            self.detector.detect(Image.new("RGB", (300, 300), (100, 100, 100)))

    @property
    def model(self):
        return self._model

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]:
        if self._phase in ("warming", "unavailable") or (
            self._active and not self._active.done()
        ):
            raise TimeoutError("perception busy or unavailable")
        self._active = asyncio.create_task(
            asyncio.to_thread(self._infer_locked, frame, view)
        )
        try:
            output = await asyncio.shield(self._active)
        except asyncio.CancelledError:
            self._phase = "degraded"
            self._snapshot = {
                "error": "timeout; worker output discarded",
                "frame_seq": frame.metadata.seq,
            }
            raise
        self._phase = "degraded" if self.last_error else "ready"
        self._loaded = self._loaded or (
            bool(self.last_timings.get("inference_ms")) and not self.last_error
        )
        self._snapshot = {
            "error": self.last_error,
            "frame_seq": frame.metadata.seq,
            "session_id": frame.metadata.session_id,
            "last_frame_at": frame.metadata.captured_at.isoformat(),
            "last_inference_at": datetime.now(UTC).isoformat(),
            "timings": self.last_timings.copy(),
            "detections": self.last_detections,
            "detection_count": len(self.last_detections),
            "uncertain_count": sum(r.state is OccupancyState.UNCERTAIN for r in output),
        }
        return output

    def _infer_locked(self, frame, view):
        with self._lock:
            return self._infer(frame, view)

    def _quality(self, pixels):
        c = self.config
        return (
            pixels.size >= c.min_roi_pixels
            and c.min_brightness <= pixels.mean() <= c.max_brightness
            and pixels.std() >= c.min_contrast
        )

    def _infer(self, frame, view):
        started = perf_counter()
        times = {"decode_ms": 0.0, "inference_ms": 0.0, "postprocess_ms": 0.0}
        uncertain = [
            SpaceInference(s.space_id, OccupancyState.UNCERTAIN, None)
            for s in view.spaces
        ]
        self.last_error = None
        self.last_detections = []
        stage = "decode_ms"
        stage_start = started
        try:
            if frame.metadata.camera_id != view.camera_id:
                return uncertain
            with Image.open(io.BytesIO(frame.jpeg)) as source:
                if source.format != "JPEG":
                    return uncertain
                w, h = source.size
                if (
                    min(w, h) < self.config.min_dimension
                    or w * h > self.config.max_pixels
                ):
                    return uncertain
                source.load()
                image = source.convert("RGB")
            gray = np.asarray(image.convert("L"))
            if not self._quality(gray):
                return uncertain
            times[stage] = (perf_counter() - stage_start) * 1000
            stage, stage_start = "inference_ms", perf_counter()
            result = self.detector.detect(image)
            self.last_detections = [
                asdict(d)
                for d in result.detections
                if d.confidence >= self.config.ambiguity_confidence
            ]
            times[stage] = (perf_counter() - stage_start) * 1000
            stage, stage_start = "postprocess_ms", perf_counter()
            # Invalid detector output makes the entire frame untrustworthy.
            for d in result.detections:
                if (
                    not math.isfinite(d.confidence)
                    or not 0 <= d.confidence <= 1
                    or len(d.box) != 4
                    or not all(math.isfinite(v) and 0 <= v <= 1 for v in d.box)
                    or d.box[0] >= d.box[2]
                    or d.box[1] >= d.box[3]
                ):
                    raise ValueError("invalid detection")
            for a in result.background:
                if not all(
                    math.isfinite(v) and 0 <= v <= 1 for v in (a.x, a.y, a.confidence)
                ):
                    raise ValueError("invalid background anchor")
            relevant = [
                (d, box(*d.box))
                for d in result.detections
                if d.confidence >= self.config.ambiguity_confidence
            ]
            out = []
            for space, fallback in zip(view.spaces, uncertain, strict=True):
                points = [(p.x, p.y) for p in space.polygon or ()]
                if len(points) < 3 or not all(
                    math.isfinite(v) and 0 <= v <= 1 for p in points for v in p
                ):
                    out.append(fallback)
                    continue
                polygon = Polygon(points)
                if not polygon.is_valid or polygon.area <= 0:
                    out.append(fallback)
                    continue
                mask = Image.new("1", (w, h))
                ImageDraw.Draw(mask).polygon(
                    [(x * (w - 1), y * (h - 1)) for x, y in points], fill=1
                )
                if not self._quality(gray[np.asarray(mask, dtype=bool)]):
                    out.append(fallback)
                    continue
                occupied, ambiguous = [], False
                for d, bounds in relevant:
                    overlap = polygon.intersection(bounds).area / polygon.area
                    if (
                        overlap >= self.config.ambiguity_coverage
                        and d.confidence >= self.config.ambiguity_confidence
                    ):
                        ambiguous = True  # pedestrians/objects obstruct OPEN, never establish OCCUPIED
                    if (
                        d.label in VEHICLES
                        and overlap >= self.config.occupied_coverage
                        and d.confidence >= self.config.occupied_confidence
                    ):
                        occupied.append(d.confidence)
                if occupied:
                    out.append(
                        SpaceInference(
                            space.space_id, OccupancyState.OCCUPIED, max(occupied)
                        )
                    )
                    continue
                if not self.config.allow_open or ambiguous:
                    out.append(fallback)
                    continue
                anchors = [
                    a for a in result.background if polygon.covers(Point(a.x, a.y))
                ]
                score = min((a.confidence for a in anchors), default=0.0)
                # Require background support across each quadrant of the ROI's bounding box.
                cx, cy = polygon.bounds[0::2], polygon.bounds[1::2]
                mx, my = sum(cx) / 2, sum(cy) / 2
                quadrants = {(a.x >= mx, a.y >= my) for a in anchors}
                if (
                    self.config.allow_open
                    and not ambiguous
                    and len(quadrants) == 4
                    and len(anchors) >= self.config.min_background_anchors
                    and score >= self.config.open_background_confidence
                ):
                    out.append(
                        SpaceInference(space.space_id, OccupancyState.OPEN, score)
                    )
                else:
                    out.append(fallback)
            return out
        except (
            UnidentifiedImageError,
            OSError,
            ValueError,
            Image.DecompressionBombError,
        ) as exc:
            self.last_error = type(exc).__name__
            log.warning("A0 rejected visual evidence: %s", self.last_error)
            return uncertain
        except Exception as exc:
            self.last_error = type(exc).__name__
            log.exception("A0 detector failed; returning UNCERTAIN")
            return uncertain
        finally:
            times[stage] = (perf_counter() - stage_start) * 1000
            self.last_timings = times | {"total_ms": (perf_counter() - started) * 1000}


def from_environment():
    from .nvidia_ssd import NvidiaSSD

    source = os.environ.get("PARKRIGHT_A0_SOURCE")
    weights = os.environ.get("PARKRIGHT_A0_WEIGHTS")
    if not source or not weights:
        return A0Provider(
            UnavailableDetector(
                "PARKRIGHT_A0_SOURCE and PARKRIGHT_A0_WEIGHTS are required"
            )
        )
    config_path = os.environ.get("PARKRIGHT_A0_CONFIG")
    config = (
        A0Config(**json.loads(Path(config_path).read_text()))
        if config_path
        else A0Config()
    )
    detector: Detector
    try:
        detector = NvidiaSSD(
            Path(source),
            Path(weights),
            os.environ.get("PARKRIGHT_A0_DEVICE", "cpu"),
            config,
        )
    except Exception as exc:
        detector = UnavailableDetector(type(exc).__name__ + ": " + str(exc))
    return A0Provider(detector, config)


class UnavailableDetector:
    """Failure state only. Never returns detections or substitutes model output."""

    identity = "nvidia-ssd300-artifacts-unavailable"
    artifacts_available = False

    def __init__(self, reason):
        self.reason = reason

    def detect(self, image):
        raise RuntimeError(self.reason)
