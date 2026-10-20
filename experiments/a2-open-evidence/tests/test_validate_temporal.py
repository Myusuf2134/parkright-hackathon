"""The temporal validator passes a well-formed dataset and fails on each defect; TEST stays sealed."""

import copy
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from seal import FROZEN_SCHEMA, require_frozen, rule_sha256  # noqa: E402
from validate_temporal import SPACES, validate  # noqa: E402

ROOT = HERE.parents[1]
CAL = json.loads((ROOT / "packages/shared/calibration/cam-01.json").read_text())
PRESETS = ["clear_day", "overcast", "dusk", "night"]
FRAMES = 5


def sequence(split, seed, preset, n=FRAMES):
    sid = f"t{seed}-ent-0-{preset}"
    events = [{"t_ms": 0, "kind": "arrive", "space_id": "A1", "nonce": 1, "role": "target"}, {"t_ms": 2000, "kind": "depart", "space_id": "B1", "nonce": 2, "role": "background"}]
    out = []
    for i in range(n):
        spaces = []
        for s in SPACES:
            truth, phase = "empty", "settled"
            if s == "A1":
                truth, phase = ("occupied", "settled") if i == n - 1 else ("empty", "entering")
            if s == "B1":
                truth, phase = ("occupied", "exiting") if i < 2 else ("empty", "exiting")
            spaces.append({"space_id": s, "truth": truth, "phase": phase})
        out.append({
            "schema": "parkright-temporal-sample-v1", "sample_id": f"{sid}-f{i:02d}", "split": split, "subset": "temporal",
            "group_id": f"seed-{seed}", "scenario_id": sid, "sequence_id": sid, "family": "entering", "seed": seed, "kind": "transition",
            "environment": {"preset_id": preset}, "camera": {"camera_id": "cam-01", "calibration_version": CAL["version"], "pose": CAL["pose"]},
            "sim_time_ms": i * 500, "t_ms": i * 500, "frame_index": i, "frame_count": n,
            "frame_metadata": {"session_id": f"tq-{sid}", "camera_id": "cam-01", "seq": i, "sim_time_ms": i * 500, "captured_at": f"2026-01-01T00:00:0{i}.000Z"},
            "image": {"path": f"images/{split}/{sid}-f{i:02d}.jpg", "width": 64, "height": 36},
            "labels_path": f"labels/{split}/{sid}-f{i:02d}.json",
            "scenario_params": {"density": "sparse", "base_occupancy": {"B1": seed}, "occluders": [], "events": events, "pattern": None},
            "spaces": spaces,
        })
    return out


def good():
    rs = []
    for split, seed in (("dev", 1), ("test", 2)):
        for preset in PRESETS:
            rs += sequence(split, seed, preset)
    return rs


def write(root: Path, records, dirty=False, images=None):
    root.mkdir(parents=True, exist_ok=True)
    sums, lsums = [], []
    for k, r in enumerate(records):
        for key in ("image", "labels"):
            (root / (r["image"]["path"] if key == "image" else r["labels_path"])).parent.mkdir(parents=True, exist_ok=True)
        path = root / r["image"]["path"]
        pixels = (images or {}).get(r["sample_id"])
        if pixels is None:
            pixels = np.random.default_rng(k).integers(0, 255, (36, 64, 3), dtype=np.uint8)
        Image.fromarray(pixels).save(path, "JPEG")
        sums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {r['image']['path']}")
        label = {"sample_id": r["sample_id"], "spaces": r["spaces"], "vehicles": [{"space_id": "B1", "occlusion": "none", "visible_fraction": 1.0}], "objects": []}
        text = json.dumps(label)
        (root / r["labels_path"]).write_text(text)
        lsums.append(f"{hashlib.sha256(text.encode()).hexdigest()}  {r['labels_path']}")
    (root / "manifest.jsonl").write_text("".join(json.dumps(r) + "\n" for r in records))
    (root / "checksums.sha256").write_text("\n".join(sums) + "\n")
    (root / "labels.sha256").write_text("\n".join(lsums) + "\n")
    (root / "calibration").mkdir(exist_ok=True)
    shutil.copy(ROOT / "packages/shared/calibration/cam-01.json", root / "calibration/cam-01.json")
    (root / "dataset.json").write_text(json.dumps({
        "schema": "parkright-temporal-dataset-v1", "config": {"seed_groups": {"dev": 1, "test": 1}, "families": {"entering": 1}},
        "provenance": {"git_commit": "abc", "git_dirty": dirty, "simulator_source_sha256": "def"},
    }))
    return root


def failures(root, **kw):
    return {e.split(":")[0] for e in validate(root, **kw).errors}


def test_well_formed_passes(tmp_path):
    rep = validate(write(tmp_path, good()))
    assert rep.errors == [], rep.errors


@pytest.mark.parametrize("mutate, check", [
    (lambda rs: [r for r in rs if not (r["sequence_id"].endswith("clear_day") and r["split"] == "dev" and r["frame_index"] == 4)], "every sequence has at least 5 frames"),
    (lambda rs: [r | {"frame_index": 3 - r["frame_index"]} if r["frame_index"] < 4 and r["split"] == "dev" else r for r in rs], "frames strictly ordered (index, time, sim time, seq)"),
    (lambda rs: [r | {"split": "dev", "image": r["image"] | {"path": r["image"]["path"].replace("/test/", "/dev/")}, "labels_path": r["labels_path"].replace("/test/", "/dev/")} if r["sequence_id"].endswith("night") and r["split"] == "test" else r for r in rs], "no seed/group/sequence/scenario/layout leakage across splits"),
    (lambda rs: [r | {"spaces": [s | {"phase": None} if s["space_id"] == "A2" else s for s in r["spaces"]]} for r in rs], "ground truth complete (12 spaces with truth and phase per frame)"),
    (lambda rs: [r | {"camera": r["camera"] | {"calibration_version": "other"}} for r in rs], "calibration version recorded on every frame and equal to the repository calibration"),
    (lambda rs: [r | {"frame_metadata": r["frame_metadata"] | {"truth": "empty"}} for r in rs], "frame_metadata is a valid production FrameMetadata with no extra field"),
    (lambda rs: [r | {"scenario_params": r["scenario_params"] | {"events": r["scenario_params"]["events"][:1]}} for r in rs], "transition annotations present and consistent with events"),
])
def test_manifest_defects_fail(tmp_path, mutate, check):
    assert check in failures(write(tmp_path, mutate(copy.deepcopy(good()))))


def test_duplicate_frames_fail(tmp_path):
    rs = good()
    same = np.full((36, 64, 3), 77, dtype=np.uint8)
    seq = rs[0]["sequence_id"]
    images = {r["sample_id"]: same for r in rs if r["sequence_id"] == seq and r["frame_index"] in (1, 2)}
    f = failures(write(tmp_path, rs, images=images))
    assert "no duplicate frame within a sequence" in f
    assert "no identical image anywhere in the dataset (no cross-split image leakage)" in f


def test_tampered_image_label_and_dirty_provenance_fail(tmp_path):
    root = write(tmp_path, good(), dirty=True)
    Image.new("RGB", (64, 36), (1, 2, 3)).save(root / good()[0]["image"]["path"], "JPEG")
    (root / good()[1]["labels_path"]).write_text("{}")
    f = failures(root)
    assert {"images exist and match generation checksums", "labels exist and match generation checksums", "provenance recorded and clean"} <= f


def test_manifest_comparison(tmp_path):
    root = write(tmp_path / "d", good())
    other = tmp_path / "plan.jsonl"
    other.write_text((root / "manifest.jsonl").read_text().replace("f00", "f99", 1))
    assert "reproducible logical labels (plan-only manifest byte-identical)" in failures(root, compare=other)


def test_test_split_is_sealed(tmp_path):
    manifest = tmp_path / "manifest.jsonl"
    manifest.write_text("{}\n")
    with pytest.raises(PermissionError, match="sealed"):
        require_frozen(None, manifest)
    rule = {"min_reference_match": 0.9, "window": 5}
    frozen = {"schema": FROZEN_SCHEMA, "status": "frozen-before-test", "dataset_manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(), "rule": rule, "rule_sha256": rule_sha256(rule)}
    path = tmp_path / "frozen.json"
    path.write_text(json.dumps(frozen))
    assert require_frozen(path, manifest)["rule"] == rule
    path.write_text(json.dumps(frozen | {"rule": rule | {"window": 2}}))
    with pytest.raises(PermissionError, match="rule changed"):
        require_frozen(path, manifest)
    path.write_text(json.dumps(frozen | {"dataset_manifest_sha256": "0" * 64}))
    with pytest.raises(PermissionError, match="dataset_manifest_sha256"):
        require_frozen(path, manifest)
