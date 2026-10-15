import json
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from parkright_contracts import (
    FacilityConfig,
    FrameMetadata,
    GroundTruthRecord,
    Identifier,
    OccupancyObservation,
    OccupancyState,
    is_confirmed_available,
    looks_like_jpeg,
    safe_state,
)
from pydantic import TypeAdapter

ROOT = Path(__file__).resolve().parents[3]
META = {"session_id": "run-1", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0, "captured_at": "2026-10-14T10:00:00Z"}


class TestFrameMetadata:
    def test_accepts_the_canonical_shape(self):
        m = FrameMetadata.model_validate(META)
        assert m.camera_id == "cam-01" and m.captured_at.tzinfo is not None

    @pytest.mark.parametrize("key", list(META))
    def test_requires_every_field(self, key):
        with pytest.raises(ValidationError):
            FrameMetadata.model_validate({k: v for k, v in META.items() if k != key})

    @pytest.mark.parametrize(
        "extra",
        [{"occupancy": []}, {"ground_truth": {}}, {"spaces": [{"space_id": "A1", "truth": "occupied"}]}, {"vehicles": []}, {"labels": {}}],
    )
    def test_rejects_anything_beyond_pixels_and_timing(self, extra):
        with pytest.raises(ValidationError):
            FrameMetadata.model_validate(META | extra)

    @pytest.mark.parametrize(
        "bad",
        [{"seq": -1}, {"seq": 1.5}, {"seq": "3"}, {"sim_time_ms": -5}, {"captured_at": "2026-10-14T10:00:00"}, {"captured_at": "yesterday"}],
    )
    def test_rejects_bad_values(self, bad):
        with pytest.raises(ValidationError):
            FrameMetadata.model_validate(META | bad)


class TestIdentifier:
    adapter = TypeAdapter(Identifier)

    @pytest.mark.parametrize("value", ["../etc", "a/b", "a b", "", ".hidden", "x" * 65, "a..b", "cam\n01"])
    def test_rejects_unsafe(self, value):
        with pytest.raises(ValidationError):
            self.adapter.validate_python(value)

    @pytest.mark.parametrize("value", ["cam-01", "A12", "run_2026.10.14", "3f1c2a9e-0000-4000-8000-000000000000"])
    def test_accepts_safe(self, value):
        assert self.adapter.validate_python(value) == value


class TestUncertainIsNeverAvailability:
    def test_only_fresh_open_is_available(self):
        assert is_confirmed_available(OccupancyState.OPEN, stale=False)
        assert not is_confirmed_available(OccupancyState.OPEN, stale=True)
        assert not is_confirmed_available(OccupancyState.UNCERTAIN, stale=False)
        assert not is_confirmed_available(OccupancyState.OCCUPIED, stale=False)

    @pytest.mark.parametrize(
        ("state", "confidence", "expected"),
        [
            (OccupancyState.OPEN, None, OccupancyState.UNCERTAIN),
            (OccupancyState.OPEN, 0.3, OccupancyState.UNCERTAIN),
            (OccupancyState.OPEN, 0.9, OccupancyState.OPEN),
            (OccupancyState.OCCUPIED, None, OccupancyState.UNCERTAIN),
            (OccupancyState.OCCUPIED, 0.2, OccupancyState.OCCUPIED),
            (OccupancyState.UNCERTAIN, 0.99, OccupancyState.UNCERTAIN),
        ],
    )
    def test_safe_state(self, state, confidence, expected):
        assert safe_state(state, confidence) is expected


def test_ground_truth_and_observations_do_not_parse_as_each_other():
    truth = {
        "session_id": "run-1", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0,
        "environment_preset": None, "spaces": [{"space_id": "A1", "truth": "occupied"}],
    }
    GroundTruthRecord.model_validate(truth)
    with pytest.raises(ValidationError):
        GroundTruthRecord.model_validate(truth | {"spaces": [{"space_id": "A1", "truth": "OPEN"}]})
    with pytest.raises(ValidationError):
        OccupancyObservation.model_validate({"space_id": "A1", "state": "occupied"})


def test_looks_like_jpeg():
    assert looks_like_jpeg(b"\xff\xd8\xff\xe0rest")
    assert not looks_like_jpeg(b"\x89PNG\r\n")
    assert not looks_like_jpeg(b"")


def test_mvp_fixture_is_valid_and_has_twelve_spaces():
    fx = FacilityConfig.model_validate(json.loads((ROOT / "packages/shared/fixtures/mvp-facility.json").read_text()))
    ids = [s.space_id for s in fx.spaces]
    assert ids == [f"{r}{i}" for r in "AB" for i in range(1, 7)]
    assert len(fx.levels) == 1 and len(fx.cameras) == 1
    assert set(fx.cameras[0].watches) == set(ids)


def test_exported_schema_is_up_to_date():
    script = ROOT / "packages/contracts/scripts/export_schema.py"
    result = subprocess.run([sys.executable, str(script), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
