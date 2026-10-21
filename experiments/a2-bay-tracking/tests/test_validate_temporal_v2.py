"""The temporal v2 validator passes on the generated dataset and fails on tampering."""

import json
import shutil
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from seal import DATASET  # noqa: E402
from validate_temporal_v2 import validate  # noqa: E402

pytestmark = pytest.mark.skipif(not (DATASET / "dataset.json").is_file(), reason="temporal v2 dataset not generated")


def test_generated_dataset_passes():
    rep = validate(DATASET)
    assert not rep.errors, rep.errors
    assert len(rep.passed) >= 22


@pytest.fixture(scope="module")
def copy(tmp_path_factory):
    """A metadata-only copy (images symlinked) to tamper with."""
    dst = tmp_path_factory.mktemp("v2")
    for name in ("manifest.jsonl", "dataset.json", "checksums.sha256", "labels.sha256"):
        shutil.copy(DATASET / name, dst / name)
    for name in ("images", "labels", "calibration"):
        (dst / name).symlink_to(DATASET / name)
    return dst


def _rewrite(root, fn):
    rows = [json.loads(line) for line in (root / "manifest.jsonl").open()]
    rows = fn(rows)
    (root / "manifest.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))


def test_cross_split_seed_leak_fails(copy, tmp_path):
    root = tmp_path / "d"
    shutil.copytree(copy, root, symlinks=True)
    dev_seed = next(r["seed"] for r in map(json.loads, (root / "manifest.jsonl").open()) if r["split"] == "dev")

    def leak(rows):
        r = next(x for x in rows if x["split"] == "test")
        r["seed"] = dev_seed
        return rows

    _rewrite(root, leak)
    assert any("leakage" in e for e in validate(root).errors)


def test_non_monotonic_capture_time_fails(copy, tmp_path):
    root = tmp_path / "d"
    shutil.copytree(copy, root, symlinks=True)

    def back(rows):
        rows[5]["frame_metadata"]["captured_at"] = rows[4]["frame_metadata"]["captured_at"]
        return rows

    _rewrite(root, back)
    assert any("strictly ordered" in e for e in validate(root).errors)


def test_reference_capture_in_test_fails(copy, tmp_path):
    root = tmp_path / "d"
    shutil.copytree(copy, root, symlinks=True)

    def move(rows):
        r = next(x for x in rows if x["split"] == "reference")
        r["family"] = "settled_empty"
        return rows

    _rewrite(root, move)
    assert any("reference split" in e for e in validate(root).errors)
