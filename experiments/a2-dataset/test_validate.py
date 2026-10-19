"""The OFFLINE dataset validator must pass a well-formed dataset and fail loudly on each defect.

    uv run --frozen --all-packages --all-extras pytest experiments/a2-dataset/test_validate.py
"""

import copy
import hashlib
import json
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SPACE_IDS  # noqa: E402
from validate import validate  # noqa: E402

W, H = 1280, 720
POLY = {s: [[10 + i * 100, 10], [90 + i * 100, 10], [90 + i * 100, 90], [10 + i * 100, 90]] for i, s in enumerate(SPACE_IDS)}
CONFIG = {
    "settled": {"layouts": {"sparse": 1}, "presets": ["clear_day"]},
    "static_empty": {"presets": []},
    "seed_groups": {"train": 1, "validation": 1, "test": 1, "robustness": 0},
}


def record(sid, split, seed, subset="standard", family="settled"):
    return {
        "schema": "parkright-dataset-sample-v1",
        "dataset_version": "t-1",
        "sample_id": sid,
        "split": split,
        "subset": subset,
        "group_id": f"seed-{seed}",
        "scenario_id": f"s{seed}",
        "family": family,
        "kind": "settled",
        "seed": seed,
        "environment": {"preset_id": "clear_day"},
        "frame_metadata": {"session_id": f"ds-{sid}", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0, "captured_at": "2026-01-01T00:00:00.000Z"},
        "image": {"path": f"images/{split}/{sid}.jpg", "width": W, "height": H},
        "labels_path": f"labels/{split}/{sid}.json",
        "scenario_params": {"density": "sparse", "base_occupancy": {"A1": seed}},
        "spaces": [{"space_id": s, "truth": "occupied" if s == "A1" else "empty"} for s in SPACE_IDS],
        "vehicles": [{"instance_id": f"A1:{seed}"}],
    }


def vehicle(seed, box=(100, 100, 200, 180)):
    return {"instance_id": f"A1:{seed}", "class": "sedan", "bbox_amodal": list(box), "bbox_visible": list(box), "visible_pixels": 500, "unoccluded_pixels": 500, "visible_fraction": 1.0, "occlusion": "none", "truncated": False}


def write(root: Path, records, labels=None, config=CONFIG):
    sums = []
    for i, r in enumerate(records):
        (root / r["image"]["path"]).parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (W, H), (i * 40 % 255, 90, 90)).save(root / r["image"]["path"], "JPEG")
        sums.append(f"{hashlib.sha256((root / r['image']['path']).read_bytes()).hexdigest()}  {r['image']['path']}")
        lab = (labels or {}).get(r["sample_id"]) or {
            "sample_id": r["sample_id"],
            "image": r["image"],
            "spaces": [{**s, "polygon_px": POLY[s["space_id"]]} for s in r["spaces"]],
            "vehicles": [vehicle(r["seed"])],
            "objects": [],
        }
        (root / r["labels_path"]).parent.mkdir(parents=True, exist_ok=True)
        (root / r["labels_path"]).write_text(json.dumps(lab))
    (root / "manifest.jsonl").write_text("\n".join(json.dumps(r) for r in records) + "\n")
    (root / "checksums.sha256").write_text("\n".join(sums) + "\n")
    (root / "dataset.json").write_text(json.dumps({"dataset_version": "t-1", "config": config, "classes": ["sedan", "hatchback", "suv", "pickup", "van"]}))
    return root


def good():
    return [record("a", "train", 1), record("b", "validation", 2), record("c", "test", 3)]


def failures(root):
    return {e.split(":")[0] for e in validate(root, None).errors}


def test_well_formed_dataset_passes(tmp_path):
    rep = validate(write(tmp_path, good()), None)
    assert rep.errors == []


@pytest.mark.parametrize(
    "mutate, check",
    [
        (lambda rs: rs.append(copy.deepcopy(rs[0])), "unique sample ids"),
        (lambda rs: rs[2].update(seed=1, group_id="seed-1", scenario_id="s1"), "no scenario/seed/layout leakage across splits"),
        (lambda rs: rs[1].update(subset="robustness", family="robust_pillar"), "robustness set isolated"),
        (lambda rs: rs[0]["frame_metadata"].update(vehicles=[]), "ground truth never in production FrameMetadata"),
        (lambda rs: rs[0].update(split="holdout"), "split is exactly one of train/validation/test"),
        (lambda rs: rs[0]["spaces"].pop(), "all 12 spaces labelled"),
        (lambda rs: rs[0]["image"].update(width=640), "image dimensions match metadata"),
    ],
)
def test_manifest_defects_fail(tmp_path, mutate, check):
    records = good()
    mutate(records)
    assert check in failures(write(tmp_path, records))


def test_out_of_bounds_box_fails(tmp_path):
    rs = good()
    lab = {"sample_id": "a", "image": rs[0]["image"], "spaces": [{**s, "polygon_px": POLY[s["space_id"]]} for s in rs[0]["spaces"]], "vehicles": [vehicle(1, (1200, 100, 1300, 180))], "objects": []}
    assert "bounding boxes inside image with positive area" in failures(write(tmp_path, rs, {"a": lab}))


def test_replaced_image_and_qa_copy_fail(tmp_path):
    root = write(tmp_path, good())
    (root / "qa").mkdir()
    (root / "qa/QA-a.png").write_bytes((root / "images/train/a.jpg").read_bytes())
    Image.new("RGB", (W, H), (1, 2, 3)).save(root / "images/validation/b.jpg", "JPEG")
    f = failures(root)
    assert "overlays never substituted for source images" in f
    assert "images match generation checksums" in f


def test_manifest_comparison(tmp_path):
    root = write(tmp_path / "d", good())
    other = tmp_path / "other.jsonl"
    other.write_text((root / "manifest.jsonl").read_text().replace('"a"', '"z"'))
    assert "deterministic manifest regeneration" in {e.split(":")[0] for e in validate(root, other).errors}
