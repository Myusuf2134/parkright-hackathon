"""EVALUATION-ONLY bay tracking + audit fixes. Production stays OCCUPIED/UNCERTAIN; allow_open stays false."""

import ast
import hashlib
import io
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

from parkright_perception.evidence import (
    EmptyReference, EvidenceConfig, FrameContext, ReferenceProvenance, SeenFrames, TemporalTracker, TrackingConfig, VehicleTracker,
    ViewGeometry, frame_evidence,
)
from parkright_perception.evidence.tracking import BayGeometry, bay_motion, bay_state

W, H = 640, 360
# Two rows of three bays facing an aisle (y 0.35–0.7, centre 0.525), calibration order TL, TR, BR, BL.
COLS = {"1": (0.3, 0.4), "2": (0.45, 0.55), "3": (0.6, 0.7)}
VIEW = ViewGeometry({
    **{f"A{k}": ((x0, 0.05), (x1, 0.05), (x1, 0.35), (x0, 0.35)) for k, (x0, x1) in COLS.items()},
    **{f"B{k}": ((x0, 0.7), (x1, 0.7), (x1, 0.95), (x0, 0.95)) for k, (x0, x1) in COLS.items()},
})
LANE = 0.525
T0 = datetime(2026, 1, 1, tzinfo=UTC)
ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / "services/perception/src/parkright_perception"
TRACK = TrackingConfig(lost_cooldown_ms=1500)
CFG = replace(EvidenceConfig(), window=3)


def px(x, y):
    return x * (W - 1), y * (H - 1)


def scene(tick=0):
    """Smooth pavement, side lines and back lines just outside each bay; `tick` moves a corner marker."""
    coarse = Image.fromarray(np.random.default_rng(1).integers(70, 111, (H // 4, W // 4), dtype=np.uint8))
    image = coarse.resize((W, H), Image.Resampling.BILINEAR).convert("RGB")
    d = ImageDraw.Draw(image)
    for sid, ((x0, y0), (x1, _), (_, y1), _) in VIEW.polygons.items():
        (ax, ay), (bx, by) = px(x0, y0), px(x1, y1)
        d.rectangle((ax - 5, ay - 2, ax - 3, by + 2), fill=(230, 230, 230))
        d.rectangle((bx + 3, ay - 2, bx + 5, by + 2), fill=(230, 230, 230))
        if sid.startswith("A"):
            d.rectangle((ax - 5, ay - 5, bx + 5, ay - 3), fill=(230, 230, 230))
        else:
            d.rectangle((ax - 5, by + 3, bx + 5, by + 5), fill=(230, 230, 230))
    d.rectangle((630 - tick % 50, 2, 636 - tick % 50, 6), fill=(255, 0, 0))
    return image


REFERENCE = EmptyReference.from_images([scene()], VIEW)
IMAGES = [scene(i) for i in range(40)]


def ctx(seq, image, *, at=None, session="s", sha=None):
    return FrameContext(
        camera_id="cam-01", session_id=session, seq=seq, captured_at=at or T0 + timedelta(milliseconds=500 * seq),
        image_sha256=sha or hashlib.sha256(image.tobytes()).hexdigest(), detector_ready=True, checkpoint_verified=True,
        detector_error=None, calibration_valid=True, expected_size=(W, H),
    )


def car(cx, cy, w=0.12, h=0.12, label="car", conf=0.9):
    """A detection centred at normalised (cx, cy)."""
    return {"label": label, "confidence": conf, "box": [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]}


def run(tracker, steps, config=CFG, start=0, **kw):
    """steps: list of detection lists, one per frame. Returns per-frame outputs."""
    outs = []
    for i, dets in enumerate(steps):
        seq = start + i
        image = IMAGES[seq % len(IMAGES)]
        c = ctx(seq, image, **kw)
        now = c.captured_at + timedelta(milliseconds=50)
        ev = frame_evidence(image, c, VIEW, dets, now, config, REFERENCE)
        outs.append(tracker.observe(c, ev, now, dets if tracker.tracking else None))
    return outs


def tracking_tracker(config=CFG, tracking=TRACK):
    return TemporalTracker(config, tracking, VIEW)


def bays():
    return [BayGeometry(s, Polygon([px(x, y) for x, y in pts])) for s, pts in VIEW.polygons.items()]


def boxes_px(dets):
    return [(d["label"], d["confidence"], (d["box"][0] * W, d["box"][1] * H, d["box"][2] * W, d["box"][3] * H)) for d in dets]


# 1. the configured motion radius is the effective one; a mismatch cannot recur silently
def test_neighbourhood_smaller_than_motion_radius_is_refused():
    with pytest.raises(ValueError, match="smaller than motion_radius_px"):
        EvidenceConfig(neighbourhood_px=300.0, motion_radius_px=360.0)
    assert EvidenceConfig(motion_radius_px=360.0).neighbourhood_px >= 360.0


def test_gate_refuses_radius_larger_than_collected_evidence():
    collected = replace(EvidenceConfig(), neighbourhood_px=300.0, motion_radius_px=40.0)
    image = IMAGES[0]
    c = ctx(0, image)
    ev = frame_evidence(image, c, VIEW, [], c.captured_at, collected, REFERENCE)
    assert all(e.near_radius_px == 300.0 for e in ev.values())
    with pytest.raises(ValueError, match="cannot support motion_radius_px 360"):
        TemporalTracker(replace(EvidenceConfig(), motion_radius_px=360.0)).observe(c, ev, c.captured_at)


def test_vehicle_between_300_and_360_px_is_seen_by_a_360_px_gate():
    cfg = replace(EvidenceConfig(), motion_radius_px=360.0, window=2)
    # A car moving ~330 px from bay A1 (beyond the old 300 px cap).
    steps = [[car(0.4 + (330 + 10 * i) / W, 0.2, w=0.05, h=0.05)] for i in range(4)]
    outs = run(TemporalTracker(cfg), steps, cfg)
    assert outs[-1]["A1"].transition_state == "suspected"


# 2. a replayed JPEG cannot become fresh after leaving the readiness window
def test_replayed_frame_after_window_eviction_is_duplicate():
    cfg = replace(CFG, window=2)
    tracker = TemporalTracker(cfg)
    run(tracker, [[] for _ in range(6)], cfg)
    image = IMAGES[0]  # frame 0 left the 2-frame window long ago
    c = ctx(20, image)
    out = tracker.observe(c, frame_evidence(image, c, VIEW, [], c.captured_at, cfg, REFERENCE), c.captured_at)
    assert "duplicate_frame" in out["A1"].blocking_reasons and not out["A1"].open_ready


# 3. the duplicate cache is bounded
def test_seen_frames_is_bounded_and_never_forgets_within_a_session():
    seen = SeenFrames(recent=128)
    base = seen.memory_bytes
    shas = [hashlib.sha256(str(i).encode()).hexdigest() for i in range(20_000)]
    for s in shas:
        seen.add(s)
    assert len(seen.recent) == 128 and seen.memory_bytes <= base + 64 * 128
    assert shas[0] in seen and shas[19_999] in seen  # first hash left the exact cache, the filter still knows it
    fresh = [hashlib.sha256(f"new{i}".encode()).hexdigest() for i in range(2000)]
    assert sum(f in seen for f in fresh) / len(fresh) < 0.01  # false positives only ever reject (conservative)


# 4. backward or repeated capture timestamps are rejected and reset evidence
@pytest.mark.parametrize("delta_ms", [-1, 0, -60_000])
def test_backward_timestamp_is_rejected_and_resets(delta_ms):
    tracker = TemporalTracker(CFG)
    run(tracker, [[] for _ in range(4)])
    last = T0 + timedelta(milliseconds=1500)
    image = IMAGES[10]
    c = ctx(10, image, at=last + timedelta(milliseconds=delta_ms))
    now = last + timedelta(milliseconds=100)
    out = tracker.observe(c, frame_evidence(image, c, VIEW, [], now, CFG, REFERENCE), now)
    assert "non_monotonic_timestamp" in out["A1"].blocking_reasons and out["A1"].distinct_frame_count == 0
    assert not out["A1"].open_ready


# 5. seq must strictly increase
def test_equal_seq_is_out_of_order():
    tracker = TemporalTracker(CFG)
    run(tracker, [[] for _ in range(4)])
    image = IMAGES[30]
    c = ctx(3, image, at=T0 + timedelta(seconds=5))
    out = tracker.observe(c, frame_evidence(image, c, VIEW, [], c.captured_at, CFG, REFERENCE), c.captured_at)
    assert "out_of_order_frame" in out["A1"].blocking_reasons and out["A1"].distinct_frame_count == CFG.window


# 6. a new session resets window, replay cache and tracks
def test_session_reset():
    tracker = tracking_tracker()
    run(tracker, [[car(0.5, LANE)] for _ in range(4)])
    assert tracker.vehicles.tracks
    outs = run(tracker, [[]], session="other")  # same pixels as frame 0 of the first session
    assert outs[0]["A1"].distinct_frame_count == 1 and "duplicate_frame" not in outs[0]["A1"].blocking_reasons
    assert tracker.vehicles.tracks == []


# 7–9. association
def test_one_vehicle_keeps_one_track():
    vt = VehicleTracker(TRACK)
    ids = set()
    for i in range(10):
        tracks = vt.update(i, i * 0.5, boxes_px([car(0.1 + 0.04 * i, LANE)]))
        ids |= {t.track_id for t in tracks}
    assert ids == {1} and vt.tracks[0].age == 10 and vt.tracks[0].velocity(TRACK)[0] > 0
    d = vt.tracks[0].to_dict(TRACK)
    assert {"track_id", "class", "confidence", "bbox", "centroid", "previous_centroids", "velocity_px_s", "age", "missed", "last_t", "last_seq"} <= set(d)


def test_two_vehicles_remain_distinct():
    vt = VehicleTracker(TRACK)
    for i in range(10):
        vt.update(i, i * 0.5, boxes_px([car(0.1 + 0.04 * i, 0.47, h=0.06), car(0.9 - 0.04 * i, 0.58, h=0.06)]))
        if i < 4:
            assert sorted(t.track_id for t in vt.tracks) == [1, 2]
    east = next(t for t in vt.tracks if t.track_id == 1)
    assert east.velocity(TRACK)[0] > 0 and len(vt.tracks) >= 2


def test_identity_ambiguity_is_flagged_and_blocks_nearby_bays():
    # One track, then two equally good detections: which one is the original is unknown.
    vt = VehicleTracker(TRACK)
    vt.update(0, 0.0, boxes_px([car(0.5, 0.45, w=0.08, h=0.08)]))
    tracks = vt.update(1, 0.5, boxes_px([car(0.47, 0.45, w=0.08, h=0.08), car(0.53, 0.45, w=0.08, h=0.08)]))
    assert any(t.ambiguous for t in tracks)
    assert bay_state(bay_motion(tracks, bays(), TRACK)["A2"]) == "ambiguous"


def test_class_mismatch_is_not_associated():
    vt = VehicleTracker(TRACK)
    vt.update(0, 0.0, boxes_px([car(0.5, LANE)]))
    vt.update(1, 0.5, boxes_px([car(0.51, LANE, label="truck")]))
    assert sorted(t.track_id for t in vt.tracks) == [1, 2] and vt.tracks[0].missed == 1


# 10–12. approach vectors
def _motion(path, label="car"):
    vt = VehicleTracker(TRACK)
    for i, (x, y) in enumerate(path):
        tracks = vt.update(i, i * 0.5, boxes_px([car(x, y, w=0.08, h=0.08, label=label)]))
    return bay_motion(tracks, bays(), TRACK)


def test_approach_vector_detected():
    m = _motion([(0.5, 0.62 - 0.04 * i) for i in range(5)])  # out of the aisle into A2
    a = next(x for x in m["A2"] if x.state == "approaching")
    assert a.cos > 0.9 and a.closing_px > 0 and a.ttb_ms is not None and a.speed_px_s > TRACK.speed_floor_px_s


def test_pass_by_is_not_a_bay_approach():
    m = _motion([(0.05 + 0.08 * i, LANE) for i in range(8)])  # along the middle of the aisle, past every bay
    for sid in VIEW.polygons:
        assert bay_state(m[sid]) == "settled", (sid, m[sid])


def test_neighbouring_bay_approach_is_localised():
    m = _motion([(0.5, 0.62 - 0.04 * i) for i in range(5)])
    assert bay_state(m["A2"]) == "approaching"
    for sid in ("A1", "A3", "B1", "B3"):
        assert bay_state(m[sid]) == "settled", (sid, m[sid])


def test_paused_vehicle_at_bay_is_ambiguous():
    m = _motion([(0.1 + 0.08 * i, 0.42) for i in range(5)] + [(0.5, 0.42)] * 3)
    assert bay_state(m["A2"]) == "ambiguous"


# 13–16. bay-specific transition state over time
def test_aborted_approach_eventually_clears():
    up = [[car(0.5, 0.62 - 0.04 * i, w=0.08, h=0.08)] for i in range(4)]
    back = [[car(0.5, 0.54 + 0.03 * i, w=0.08, h=0.08)] for i in range(3)]
    away = [[car(0.5 + 0.12 * (i + 1), LANE, w=0.08, h=0.08)] for i in range(4)] + [[] for _ in range(6)]
    outs = run(tracking_tracker(), up + back + away)
    assert any(o["A2"].bay_motion == "approaching" for o in outs[:5])
    assert not any(o["A2"].open_ready for o in outs[:8])
    assert outs[-1]["A2"].open_ready, outs[-1]["A2"].blocking_reasons


def test_disappearing_track_near_bay_blocks():
    approach = [[car(0.5, 0.62 - 0.04 * i, w=0.08, h=0.08)] for i in range(4)]
    outs = run(tracking_tracker(), approach + [[] for _ in range(8)])
    after = outs[4:]
    assert after[0]["A2"].bay_motion == "lost" and not after[0]["A2"].open_ready
    # Still blocked after the track is deleted (max_missed) while the cooldown runs.
    gone = TRACK.max_missed + 1
    assert any("transition_lost" in o["A2"].blocking_reasons for o in after[gone:gone + 2])
    assert not any(o["A2"].open_ready for o in after[: gone + 2])


def test_lost_track_without_cooldown_unblocks_sooner():
    approach = [[car(0.5, 0.62 - 0.04 * i, w=0.08, h=0.08)] for i in range(4)]
    tail = [[] for _ in range(8)]
    with_cd = run(tracking_tracker(), approach + tail)
    without = run(tracking_tracker(tracking=replace(TRACK, lost_cooldown_ms=0.0)), approach + tail)
    first = lambda outs: next((i for i, o in enumerate(outs) if o["A2"].open_ready), 99)  # noqa: E731
    assert first(with_cd) > first(without)


def test_departing_track_blocks_until_positive_evidence_returns():
    parked = [[car(0.5, 0.2, w=0.1, h=0.3)] for _ in range(3)]
    leaving = [[car(0.5, 0.26 + 0.06 * i, w=0.1, h=0.3)] for i in range(4)]
    away = [[car(0.5 + 0.15 * (i + 1), LANE, w=0.1, h=0.1)] for i in range(3)] + [[] for _ in range(6)]
    outs = run(tracking_tracker(), parked + leaving + away)
    assert all("occupied_evidence" in o["A2"].blocking_reasons for o in outs[:3])
    assert any(o["A2"].bay_motion == "departing" for o in outs[3:8])
    first_clear = next(i for i in range(7, len(outs)) if not any(d for d in (parked + leaving + away)[i]))
    assert not outs[first_clear]["A2"].open_ready  # the window still holds the departure
    assert outs[-1]["A2"].open_ready, outs[-1]["A2"].blocking_reasons


def test_occupied_evidence_overrides_tracking():
    outs = run(tracking_tracker(), [[car(0.5, 0.2, w=0.1, h=0.3)] for _ in range(6)])
    assert outs[-1]["A2"].bay_motion == "settled" and not outs[-1]["A2"].open_ready
    assert "occupied_evidence" in outs[-1]["A2"].blocking_reasons


def test_unrelated_pass_by_blocks_coarse_gate_but_not_tracking_gate():
    steps = [[car(0.05 + 0.07 * i, LANE, w=0.08, h=0.08)] for i in range(10)]
    coarse = replace(CFG, motion_radius_px=360.0)
    assert not run(TemporalTracker(coarse), steps, coarse)[-1]["B1"].open_ready
    assert run(tracking_tracker(), steps)[-1]["B1"].open_ready


# 17. TEST images can never build empty references
def _capture(split="reference", sha=None, camera="cam-01", version="cal-v1"):
    buf = io.BytesIO()
    IMAGES[0].save(buf, "JPEG")
    data = buf.getvalue()
    meta = ReferenceProvenance(camera, version, split, "calibration_reference", sha or hashlib.sha256(data).hexdigest(), "ref-0", "designated", ("A1", "B2"))
    return meta, data


def test_reference_from_test_split_is_rejected():
    with pytest.raises(ValueError, match="may not build empty references"):
        EmptyReference.from_provenance([_capture("test")], VIEW, "cam-01", "cal-v1")


def test_reference_provenance_is_checked_and_hashed():
    ref = EmptyReference.from_provenance([_capture()], VIEW, "cam-01", "cal-v1")
    assert len(ref.patches["A1"]) == 1 and ref.patches["A2"] == [] and len(ref.aggregate_sha256) == 64
    with pytest.raises(ValueError, match="SHA-256"):
        EmptyReference.from_provenance([_capture(sha="0" * 64)], VIEW, "cam-01", "cal-v1")
    with pytest.raises(ValueError, match="captured for"):
        EmptyReference.from_provenance([_capture(camera="cam-02")], VIEW, "cam-01", "cal-v1")


# 23–27. production unchanged
def test_allow_open_remains_false():
    from parkright_perception.a0.config import A0Config

    assert A0Config().allow_open is False
    assert not hasattr(TrackingConfig(), "allow_open")


def test_production_runtime_never_imports_evidence_or_tracking():
    for path in PKG.rglob("*.py"):
        if "evidence" in path.parts:
            continue
        tree = ast.parse(path.read_text())
        names = [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)] + [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
        assert not any("evidence" in m or "tracking" in m for m in names), path
    code = (
        "import sys\n"
        "from parkright_api.config import Settings\n"
        "from parkright_api.main import create_app\n"
        "create_app(Settings(env='production', ingest_token='t'*32, perception_provider='a2', _env_file=None))\n"
        "assert not [m for m in sys.modules if m.startswith('parkright_perception.evidence')]\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


# Production perception (A0, A2 OCCUPIED mapping) and Nemotron recommendation code are byte-identical
# to the integrated demo (integration/a2-nemotron-demo a696787).
PINNED = {
    "services/perception/src/parkright_perception/__init__.py": "7ed8139d18797b31e30bf7c8e0af1320dac1bfb9420c26c0486357fd07bd5579",
    "services/perception/src/parkright_perception/provider.py": "a2a472e03f5d665f04becf287c2747112adb48439f532807a93be24cf531b66e",
    "services/perception/src/parkright_perception/registry.py": "57c34a161e03fd2b04467d124b4835cc7e083ad5834276aae9f4931b951f9c6b",
    "services/perception/src/parkright_perception/normalize.py": "89171c9e3a971d4926837f3644ec049b78ddd5011d5984a1eb890a40257154ce",
    "services/perception/src/parkright_perception/a0/config.py": "2676defb832b182131dcc55edd5ba54aeb6878db7ccc1ef1edee2d87da376b6c",
    "services/perception/src/parkright_perception/a0/provider.py": "e3c20c65a21bc6cee7618584c7e9908847fb132331886c4c6dba4e5fa82409f7",
    "services/perception/src/parkright_perception/a2/fasterrcnn.py": "877487f9bfeab8dd7389db7357e2e86c482c2072d59365eaaa1cb7cc75ca348c",
    "services/perception/src/parkright_perception/a2/provider.py": "318c0caccfd3ad2d68e1045ee82f9cd9d389cd255607058ab7f5bd397d84ad15",
    "services/api/src/parkright_api/main.py": "bf6446e92af81f687a61bd33d52654e65929031718597c7f2981dd323097e4dc",
    "services/api/src/parkright_api/recommendations/client.py": "bff525573c24aadf3b6888ae8674a428e09d304ef5473e63e12def96013e4d7b",
    "services/api/src/parkright_api/recommendations/facts.py": "1631ce0ee83ff67dfd5d38c4443e495f0f3edd7e6be07f5aef9d3ab8758b1e90",
    "services/api/src/parkright_api/recommendations/models.py": "05648e00ba5376fa0a2c4cb40d4bcb23e5f9032f32efc1fc0bb407c6d01d7018",
    "services/api/src/parkright_api/recommendations/service.py": "98d7379a03fc6a449bd6eca8493c8dc5abde55d6babdce0c993f781bd9ff0c88",
    "services/api/src/parkright_api/routes/recommendations.py": "265c0527cba3569e0c77c0d215b1d02f8595814b07f2079b2ab6fe6f15a6be1e",
}


@pytest.mark.parametrize("rel", sorted(PINNED))
def test_production_and_nemotron_code_unchanged(rel):
    assert hashlib.sha256((ROOT / rel).read_bytes()).hexdigest() == PINNED[rel]
