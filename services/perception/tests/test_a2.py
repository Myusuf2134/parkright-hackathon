"""A2 Faster R-CNN behind the calibrated space mapper: selection, checkpoint safety, mapping, OPEN disabled."""

import asyncio
import io
import json
import os
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from parkright_contracts import FrameMetadata, OccupancyState, Point
from parkright_perception import CameraView, Frame, WatchedSpace, create_provider
from parkright_perception.a0.config import A0Config
from parkright_perception.a0.provider import A0Provider

from parkright_perception.a2.fasterrcnn import CHECKPOINT_SHA256, FasterRCNNA2, sha256_file
from parkright_perception.a2.provider import DEFAULT_CHECKPOINT
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
CAL = json.loads((ROOT / "packages/shared/calibration/cam-01.json").read_text())
VIEW = CameraView("cam-01", tuple(WatchedSpace(s, tuple(Point(**p) for p in pts)) for s, pts in CAL["polygons"].items()))
DATASET = Path.home() / ".cache/parkright/datasets/a2-sim-v1-b569da957c"
A0_SOURCE = Path(os.environ.get("PARKRIGHT_A0_SOURCE", Path.home() / ".cache/parkright/nvidia-ssd"))
A0_WEIGHTS = Path(os.environ.get("PARKRIGHT_A0_WEIGHTS", Path.home() / ".cache/parkright/nvidia-ssd.pt"))
needs_checkpoint = pytest.mark.skipif(not DEFAULT_CHECKPOINT.is_file(), reason="A2 checkpoint not present locally")
U, X = OccupancyState.UNCERTAIN, OccupancyState.OCCUPIED


def jpeg(size=(1280, 720)) -> bytes:
    pixels = np.random.default_rng(7).integers(40, 200, (size[1], size[0], 3), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="JPEG")
    return buf.getvalue()


def frame(data: bytes) -> Frame:
    return Frame(FrameMetadata(session_id="a2", camera_id="cam-01", seq=1, sim_time_ms=0, captured_at=datetime.now(UTC)), data)


def bounds(space_id: str, w=1280, h=720):
    xs = [p["x"] * w for p in CAL["polygons"][space_id]]
    ys = [p["y"] * h for p in CAL["polygons"][space_id]]
    return [min(xs), min(ys), max(xs), max(ys)]


class FakeModel:
    """Stands in for the network only; the detector's own decoding and the mapper are real."""

    def __init__(self, rows):
        self.rows = rows

    def __call__(self, images):
        import torch

        assert len(images) == 1 and images[0].shape[0] == 3 and float(images[0].max()) <= 1
        return [{
            "boxes": torch.tensor([r[0] for r in self.rows], dtype=torch.float32).reshape(-1, 4),
            "labels": torch.tensor([r[1] for r in self.rows], dtype=torch.int64),
            "scores": torch.tensor([r[2] for r in self.rows], dtype=torch.float32),
        }]


def fake_detector(tmp_path, rows) -> FasterRCNNA2:
    artifact = tmp_path / "fake.pt"
    artifact.write_bytes(b"not a real checkpoint")
    detector = FasterRCNNA2(artifact, expected_sha256=sha256_file(artifact))
    detector._model = FakeModel(rows)
    return detector


def states(provider, data=None):
    out = asyncio.run(provider.infer(frame(data or jpeg()), VIEW))
    return {o.space_id: o.state for o in out}, out


# A. A0 is still selectable and unchanged.
def test_a0_still_selectable(monkeypatch):
    monkeypatch.setenv("PARKRIGHT_A0_SOURCE", str(A0_SOURCE))
    monkeypatch.setenv("PARKRIGHT_A0_WEIGHTS", str(A0_WEIGHTS))
    p = create_provider("a0")
    assert p.model.provider == "a0-nvidia-ssd300"
    assert p.diagnostics()["thresholds"] == asdict(A0Config())


@pytest.mark.skipif(not (A0_WEIGHTS.is_file() and (A0_SOURCE / ".git").exists()), reason="A0 artifacts not present locally")
def test_a0_real_artifacts_initialize(monkeypatch):
    monkeypatch.setenv("PARKRIGHT_A0_SOURCE", str(A0_SOURCE))
    monkeypatch.setenv("PARKRIGHT_A0_WEIGHTS", str(A0_WEIGHTS))
    p = create_provider("a0")
    asyncio.run(p.warmup())
    d = p.diagnostics()
    assert d["phase"] == "ready" and d["identity"].startswith("nvidia-ssd300:20.06.0:")


# B. A2 initializes with the expected checkpoint.
@needs_checkpoint
def test_a2_real_checkpoint_initializes_and_maps_held_out_frame(monkeypatch):
    monkeypatch.delenv("PARKRIGHT_A2_CHECKPOINT", raising=False)
    p = create_provider("a2")
    assert p.model.provider == "a2-fasterrcnn"
    asyncio.run(p.warmup())
    d = p.diagnostics()
    assert d["phase"] == "ready" and d["model_loaded"] and CHECKPOINT_SHA256 in d["identity"]
    assert d["thresholds"]["allow_open"] is False
    if not (DATASET / "manifest.jsonl").is_file():
        pytest.skip("dataset not present locally; initialization verified only")
    with (DATASET / "manifest.jsonl").open() as manifest:
        record = next(r for r in map(json.loads, manifest) if r["split"] == "test" and r["family"] == "settled")
    got, _ = states(p, (DATASET / record["image"]["path"]).read_bytes())
    truth = {s["space_id"]: s["truth"] for s in record["spaces"]}
    # Held-out frame: OCCUPIED exactly where truth is occupied; everything else UNCERTAIN, never OPEN.
    assert {s for s, v in got.items() if v is X} == {s for s, v in truth.items() if v == "occupied"}
    assert all(v in (X, U) for v in got.values())


# C. Wrong or missing checkpoints fail safely, before torch.load.
def test_missing_checkpoint_is_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("PARKRIGHT_A2_CHECKPOINT", str(tmp_path / "absent.pt"))
    p = create_provider("a2")
    asyncio.run(p.warmup())
    d = p.diagnostics()
    assert p.model.provider == "a2-fasterrcnn"
    assert d["phase"] == "unavailable" and not d["weights_available"] and "not found" in d["artifact_error"]
    with pytest.raises(TimeoutError):
        states(p)


def test_wrong_checkpoint_is_rejected_without_loading(monkeypatch, tmp_path):
    import torch

    bad = tmp_path / "best.pt"
    bad.write_bytes(b"tampered")
    monkeypatch.setenv("PARKRIGHT_A2_CHECKPOINT", str(bad))
    monkeypatch.setattr(torch, "load", lambda *a, **k: pytest.fail("torch.load called on unverified checkpoint"))
    p = create_provider("a2")
    asyncio.run(p.warmup())
    assert p.diagnostics()["phase"] == "unavailable"
    assert "does not match the frozen A2 artifact" in p.diagnostics()["artifact_error"]


def test_only_explicit_devices(tmp_path):
    artifact = tmp_path / "x.pt"
    artifact.write_bytes(b"x")
    with pytest.raises(ValueError, match="explicit cpu or cuda"):
        FasterRCNNA2(artifact, device="mps", expected_sha256=sha256_file(artifact))


# D. A2 output flows through the calibrated mapper with the existing thresholds.
def test_a2_boxes_flow_through_calibrated_mapping(tmp_path):
    detector = fake_detector(tmp_path, [
        (bounds("A1"), 1, 0.97),   # car
        (bounds("B2"), 2, 0.91),   # pickup → truck
        (bounds("A3"), 1, 0.60),   # below 0.65: never OCCUPIED
        (bounds("B6"), 7, 0.99),   # unknown class: obstruction, never OCCUPIED
    ])
    p = A0Provider(detector, A0Config())
    got, out = states(p)
    assert got["A1"] is X and got["B2"] is X
    assert got["A3"] is U and got["B6"] is U
    assert {o.space_id: o.confidence for o in out if o.state is X} == pytest.approx({"A1": 0.97, "B2": 0.91})
    labels = {d["label"] for d in p.diagnostics()["detections"]}
    assert labels == {"car", "truck", "obstruction"}
    # Boxes are normalised to the full frame.
    assert all(0 <= v <= 1 for d in p.diagnostics()["detections"] for v in d["box"])


def test_detector_failure_is_uncertain(tmp_path):
    detector = fake_detector(tmp_path, [])
    detector._model = lambda images: (_ for _ in ()).throw(RuntimeError("boom"))
    got, _ = states(A0Provider(detector, A0Config()))
    assert set(got.values()) == {U}


# E. OPEN stays disabled: an empty lot is UNCERTAIN, never OPEN.
def test_open_disabled_for_a2(tmp_path):
    p = A0Provider(fake_detector(tmp_path, []), A0Config())
    got, _ = states(p)
    assert set(got.values()) == {U}
    # Even if OPEN were enabled, A2 supplies no background evidence that could establish it.
    from dataclasses import replace

    enabled = A0Provider(fake_detector(tmp_path, []), replace(A0Config(), allow_open=True))
    assert OccupancyState.OPEN not in states(enabled)[0].values()


def test_a2_factory_pins_safe_thresholds(monkeypatch, tmp_path):
    # The A0 config override does not apply to A2.
    override = tmp_path / "unsafe.json"
    override.write_text(json.dumps({"allow_open": True, "occupied_confidence": 0.1}))
    monkeypatch.setenv("PARKRIGHT_A0_CONFIG", str(override))
    monkeypatch.setenv("PARKRIGHT_A2_CHECKPOINT", str(tmp_path / "absent.pt"))
    t = create_provider("a2").diagnostics()["thresholds"]
    assert t["allow_open"] is False and t["occupied_confidence"] == 0.65 and t["occupied_coverage"] == 0.45
