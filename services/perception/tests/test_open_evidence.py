"""EVALUATION-ONLY OPEN evidence: every gate blocks open_ready on its own; production stays OCCUPIED/UNCERTAIN."""

import ast
import hashlib
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from parkright_perception.a0.config import A0Config
from parkright_perception.evidence import EmptyReference, EvidenceConfig, FrameContext, TemporalTracker, ViewGeometry, frame_evidence

W, H = 640, 360
# Two bays facing an aisle between them, calibration order TL, TR, BR, BL.
VIEW = ViewGeometry({
    "A1": ((0.2, 0.15), (0.4, 0.15), (0.4, 0.45), (0.2, 0.45)),
    "B1": ((0.2, 0.6), (0.4, 0.6), (0.4, 0.9), (0.2, 0.9)),
})
T0 = datetime(2026, 1, 1, tzinfo=UTC)
PKG = Path(__file__).resolve().parents[1] / "src" / "parkright_perception"


def px(x, y):
    return x * (W - 1), y * (H - 1)


def scene(tick=0, block=None, car=None):
    """Pavement with painted lines just outside each bay's side and back edges; `tick` moves a far-away marker."""
    # Smooth asphalt-like texture: coarse noise upsampled (contrast without strong gradients).
    coarse = Image.fromarray(np.random.default_rng(1).integers(70, 111, (H // 4, W // 4), dtype=np.uint8))
    image = coarse.resize((W, H), Image.Resampling.BILINEAR).convert("RGB")
    d = ImageDraw.Draw(image)
    for (x0, y0), (x1, _), (_, y1), _ in VIEW.polygons.values():
        (ax, ay), (bx, by) = px(x0, y0), px(x1, y1)
        d.rectangle((ax - 5, ay - 2, ax - 3, by + 2), fill=(230, 230, 230))
        d.rectangle((bx + 3, ay - 2, bx + 5, by + 2), fill=(230, 230, 230))
    (ax, ay), (bx, _) = px(0.2, 0.15), px(0.4, 0.15)
    d.rectangle((ax - 5, ay - 5, bx + 5, ay - 3), fill=(230, 230, 230))  # A1 back line
    (ax, _), (bx, by) = px(0.2, 0.9), px(0.4, 0.9)
    d.rectangle((ax - 5, by + 3, bx + 5, by + 5), fill=(230, 230, 230))  # B1 back line
    d.rectangle((600 - tick * 3, 10, 610 - tick * 3, 20), fill=(255, 0, 0))
    if block:
        d.rectangle(block, fill=(140, 140, 140))
    if car:
        d.rectangle(car, fill=(20, 20, 30))
        d.rectangle((car[0] + 10, car[1] + 10, car[2] - 10, car[1] + 30), fill=(200, 210, 240))
    return image


REFERENCE = EmptyReference.from_images([scene()], VIEW)


def ctx(seq, image, *, at=None, session="s", **over):
    base = {
        "camera_id": "cam-01", "session_id": session, "seq": seq, "captured_at": at or T0 + timedelta(milliseconds=500 * seq),
        "image_sha256": hashlib.sha256(image.tobytes()).hexdigest(), "detector_ready": True, "checkpoint_verified": True,
        "detector_error": None, "calibration_valid": True, "expected_size": (W, H),
    }
    return FrameContext(**(base | over))


def feed(tracker, frames, config=EvidenceConfig()):
    out = None
    for seq, image, detections, over in frames:
        c = ctx(seq, image, **over)
        now = c.captured_at + timedelta(milliseconds=50)
        out = tracker.observe(c, frame_evidence(image, c, VIEW, detections, now, config, REFERENCE), now)
    return out


def empty_frames(n, start=0, **over):
    return [(start + i, scene(start + i), [], over) for i in range(n)]


def box_over(space, grow=0.0):
    (x0, y0), (x1, _), (_, y1), _ = VIEW.polygons[space]
    return [x0 - grow, y0 - grow, x1 + grow, y1 + grow]


def test_positive_evidence_over_five_distinct_frames_is_open_ready():
    out = feed(TemporalTracker(), empty_frames(5))
    for sid in ("A1", "B1"):
        assert out[sid].open_ready, out[sid].blocking_reasons
        assert out[sid].distinct_frame_count == 5 and out[sid].transition_state == "settled" and out[sid].advisory_only


# 1. duplicates never count
def test_duplicate_frames_do_not_count():
    same = scene(0)
    out = feed(TemporalTracker(), [(i, same, [], {}) for i in range(8)])
    assert out["A1"].distinct_frame_count == 1 and not out["A1"].open_ready
    assert "duplicate_frame" in out["A1"].blocking_reasons


def test_duplicate_after_ready_is_not_ready():
    tracker = TemporalTracker()
    feed(tracker, empty_frames(5))
    out = feed(tracker, [(10, scene(4), [], {})])  # same pixels as frame 4
    assert not out["A1"].open_ready and "duplicate_frame" in out["A1"].blocking_reasons


# 2. out-of-order frames are rejected
def test_out_of_order_frames_are_rejected():
    tracker = TemporalTracker()
    feed(tracker, empty_frames(5, start=10))
    out = feed(tracker, [(3, scene(99), [], {"at": T0 + timedelta(seconds=8)})])
    assert not out["A1"].open_ready and "out_of_order_frame" in out["A1"].blocking_reasons
    assert out["A1"].distinct_frame_count == 5


# 3. stale frames never contribute
def test_stale_frames_cannot_contribute():
    tracker = TemporalTracker()
    frames = [(i, scene(i), [], {"at": T0 - timedelta(seconds=60)}) for i in range(5)]
    for seq, image, det, over in frames:
        c = ctx(seq, image, **over)
        now = T0  # 60 s after capture
        out = tracker.observe(c, frame_evidence(image, c, VIEW, det, now, EvidenceConfig(), REFERENCE), now)
    assert out["A1"].distinct_frame_count == 0 and not out["A1"].open_ready
    assert "stale_frame" in out["A1"].blocking_reasons and "frame:frame_stale" in out["A1"].blocking_reasons


def test_gap_restarts_the_window():
    tracker = TemporalTracker()
    feed(tracker, empty_frames(4))
    out = feed(tracker, [(5, scene(5), [], {"at": T0 + timedelta(seconds=30)})])
    assert out["A1"].distinct_frame_count == 1 and not out["A1"].open_ready


# 4. detector failure blocks
@pytest.mark.parametrize("over, reason", [
    ({"detector_error": "RuntimeError"}, "frame:detector_error"),
    ({"detector_ready": False}, "frame:detector_not_ready"),
    ({"checkpoint_verified": False}, "frame:checkpoint_not_verified"),
])
def test_detector_failure_blocks(over, reason):
    out = feed(TemporalTracker(), empty_frames(4) + [(4, scene(4), [], over)])
    assert not out["A1"].open_ready and reason in out["A1"].blocking_reasons and not out["A1"].frame_valid


# 5. invalid calibration blocks
@pytest.mark.parametrize("over, reason", [({"calibration_valid": False}, "frame:calibration_invalid"), ({"expected_size": (1280, 720)}, "frame:frame_size_mismatch")])
def test_invalid_calibration_blocks(over, reason):
    out = feed(TemporalTracker(), empty_frames(5, **over))
    assert not out["A1"].open_ready and reason in out["A1"].blocking_reasons


# 6. insufficient visibility blocks
def test_insufficient_visibility_blocks():
    view = ViewGeometry({"A1": ((0.85, 0.15), (1.2, 0.15), (1.2, 0.45), (0.85, 0.45)), "B1": VIEW.polygons["B1"]})
    image = scene(0)
    c = ctx(0, image)
    ev = frame_evidence(image, c, view, [], c.captured_at, EvidenceConfig(), REFERENCE)
    assert ev["A1"].visibility_score < 0.95 and "insufficient_visibility" in ev["A1"].blocking(EvidenceConfig())
    dark = Image.new("RGB", (W, H), (5, 5, 5))
    ev = frame_evidence(dark, ctx(0, dark), VIEW, [], c.captured_at, EvidenceConfig(), REFERENCE)
    assert ev["A1"].visibility_score == 0 and "insufficient_visibility" in ev["A1"].blocking(EvidenceConfig())


# 7. occlusion risk blocks (an undetected object hides the bay's paint)
def test_occlusion_risk_blocks():
    (x0, y0), (x1, y1) = px(0.15, 0.1), px(0.45, 0.3)
    frames = [(i, scene(i, block=(x0, y0, x1, y1)), [], {}) for i in range(5)]
    out = feed(TemporalTracker(), frames)
    assert not out["A1"].open_ready
    assert {"occlusion_risk", "markings_not_visible"} & set(out["A1"].blocking_reasons)
    assert out["B1"].open_ready  # unaffected bay


def test_foreground_detection_is_occlusion_risk():
    # A box standing nearer the camera (bottom below the bay) covering part of A1.
    det = [{"label": "obstruction", "confidence": 0.3, "box": [0.25, 0.3, 0.3, 0.55]}]
    image = scene(0)
    c = ctx(0, image)
    ev = frame_evidence(image, c, VIEW, det, c.captured_at, EvidenceConfig(), REFERENCE)["A1"]
    assert ev.foreground_cover > 0 and ev.occlusion_risk >= ev.foreground_cover


# 8. transition risk blocks
def test_partial_vehicle_overlap_is_transition():
    det = [{"label": "car", "confidence": 0.9, "box": [0.35, 0.3, 0.5, 0.5]}]  # partly in A1, not OCCUPIED
    out = feed(TemporalTracker(), empty_frames(4) + [(4, scene(4), det, {})])
    assert not out["A1"].open_ready and out["A1"].transition_state == "suspected"


def test_moving_vehicle_near_bay_is_transition():
    frames = [(i, scene(i), [{"label": "car", "confidence": 0.9, "box": [0.41 + 0.02 * i, 0.2, 0.5 + 0.02 * i, 0.4]}], {}) for i in range(5)]
    out = feed(TemporalTracker(), frames)
    assert out["A1"].transition_state == "suspected" and "transition_suspected" in out["A1"].blocking_reasons


def test_appearance_change_is_transition():
    (x0, y0), (x1, y1) = px(0.25, 0.2), px(0.3, 0.3)
    frames = empty_frames(4) + [(4, scene(4, block=(x0, y0, x1, y1)), [], {})]
    out = feed(TemporalTracker(replace(EvidenceConfig(), min_reference_match=-1, max_interior_clutter=1)), frames, replace(EvidenceConfig(), min_reference_match=-1, max_interior_clutter=1))
    assert out["A1"].transition_state == "suspected"


def test_first_frame_transition_is_unknown():
    out = feed(TemporalTracker(replace(EvidenceConfig(), window=1)), empty_frames(1))
    assert out["A1"].transition_state == "unknown" and not out["A1"].open_ready


# 9. fewer than the required distinct frames blocks
@pytest.mark.parametrize("window", [2, 3, 5])
def test_window_requires_distinct_frames(window):
    c = replace(EvidenceConfig(), window=window)
    tracker = TemporalTracker(c)
    for i in range(window):
        out = feed(tracker, [(i, scene(i), [], {})], c)
        assert out["A1"].open_ready == (i == window - 1), (i, out["A1"].blocking_reasons)
    assert "insufficient_distinct_frames" in feed(TemporalTracker(c), empty_frames(window - 1), c)["A1"].blocking_reasons


# 10. OCCUPIED evidence always overrides
def test_occupied_vehicle_evidence_overrides():
    det = [{"label": "car", "confidence": 0.9, "box": box_over("A1", 0.01)}]
    out = feed(TemporalTracker(), [(i, scene(i), det, {}) for i in range(5)])
    assert not out["A1"].open_ready and "occupied_evidence" in out["A1"].blocking_reasons


def test_dark_car_without_detection_fails_surface_evidence():
    # Detector missed it entirely: positive empty evidence still fails.
    (x0, y0), (x1, y1) = px(0.22, 0.18), px(0.38, 0.42)
    out = feed(TemporalTracker(), [(i, scene(i, car=(x0, y0, x1, y1)), [], {}) for i in range(5)])
    assert not out["A1"].open_ready
    assert {"no_empty_reference_match", "interior_not_clear"} & set(out["A1"].blocking_reasons)


def test_no_reference_means_no_readiness():
    image = scene(0)
    c = ctx(0, image)
    ev = frame_evidence(image, c, VIEW, [], c.captured_at, EvidenceConfig(), None)
    assert "no_empty_reference_match" in ev["A1"].blocking(EvidenceConfig())


# 11. ground truth never consumed; production never imports the evidence package
def test_evidence_api_has_no_ground_truth_inputs():
    import inspect

    from parkright_perception.evidence import frame as frame_mod, temporal as temporal_mod

    for fn in (frame_evidence, TemporalTracker.observe, EmptyReference.from_images):
        assert not {"truth", "ground_truth", "labels", "phase"} & set(inspect.signature(fn).parameters)
    for mod in (frame_mod, temporal_mod):
        tree = ast.parse(Path(mod.__file__).read_text())
        names = [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)] + [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
        assert not any("evaluation" in m or "dataset" in m for m in names)
    assert not {"truth", "phase", "ground_truth"} & {f for f in FrameContext.__dataclass_fields__}


def test_production_path_never_imports_evidence():
    for rel in ("a0/provider.py", "a2/provider.py", "a2/fasterrcnn.py", "registry.py", "provider.py", "normalize.py", "__init__.py"):
        tree = ast.parse((PKG / rel).read_text())
        names = [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)] + [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
        assert not any("evidence" in m for m in names), rel
    code = (
        "import sys\n"
        "from parkright_api.config import Settings\n"
        "from parkright_api.main import create_app\n"
        "create_app(Settings(env='production', ingest_token='t'*32, perception_provider='a2', _env_file=None))\n"
        "assert 'parkright_perception.evidence' not in sys.modules\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


# 12. allow_open stays false
def test_allow_open_remains_false(monkeypatch, tmp_path):
    from parkright_perception import create_provider

    assert A0Config().allow_open is False
    monkeypatch.setenv("PARKRIGHT_A2_CHECKPOINT", str(tmp_path / "absent.pt"))
    assert create_provider("a2").diagnostics()["thresholds"]["allow_open"] is False
    assert EvidenceConfig().occupied_confidence == 0.65 and EvidenceConfig().occupied_coverage == 0.45
