"""Validate an OFFLINE A2 simulator dataset. Exits nonzero on any failure.

    uv run --frozen --all-packages --all-extras python experiments/a2-dataset/validate.py <dataset>
        [--compare-manifest <manifest.jsonl>]   # byte-identical regeneration check

Checks files, image dimensions, boxes, polygons, space labels, splits, group and
robustness isolation, coverage, classes, and that no ground truth can reach production
FrameMetadata or be swapped for a source image.
"""

import argparse
import hashlib
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image
from pydantic import ValidationError
from shapely.geometry import Polygon

from parkright_contracts import FrameMetadata

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    DENSITIES,
    ROBUSTNESS_FAMILIES,
    SPACE_IDS,
    SPLITS,
    STANDARD_FAMILIES,
    load_checksums,
    load_dataset,
    load_label,
    load_manifest,
)

FRAME_FIELDS = {"session_id", "camera_id", "seq", "sim_time_ms", "captured_at"}


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.passed: list[str] = []

    def check(self, name: str, problems: list[str]):
        if problems:
            self.errors += [f"{name}: {p}" for p in problems]
        else:
            self.passed.append(name)


def box_problems(box, w, h, label):
    if box is None:
        return []
    x0, y0, x1, y1 = box
    out = []
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        out.append(f"{label} box {box} outside {w}x{h} or non-positive area")
    return out


def production_contract_problems() -> list[str]:
    out = []
    if set(FrameMetadata.model_fields) != FRAME_FIELDS:
        out.append(f"FrameMetadata fields changed: {sorted(FrameMetadata.model_fields)}")
    if FrameMetadata.model_config.get("extra") != "forbid":
        out.append("FrameMetadata no longer forbids extra fields")
    probe = {"session_id": "s", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0, "captured_at": "2026-01-01T00:00:00Z"}
    for leak in ("spaces", "vehicles", "ground_truth", "labels", "bbox", "occupancy"):
        try:
            FrameMetadata.model_validate({**probe, leak: []})
            out.append(f"FrameMetadata accepted a '{leak}' field")
        except ValidationError:
            pass
    return out


def validate(root: Path, compare: Path | None) -> Report:
    rep = Report()
    manifest = load_manifest(root)
    dataset = load_dataset(root)
    checksums = load_checksums(root)
    config = dataset["config"]
    classes = set(dataset["classes"])
    version = dataset["dataset_version"]
    # ---- identity and files ----
    seen_ids: set[str] = set()
    dup = []
    for r in manifest:
        if r["sample_id"] in seen_ids:
            dup.append(r["sample_id"])
        seen_ids.add(r["sample_id"])
    rep.check("unique sample ids", [f"duplicate {d}" for d in dup])
    rep.check("dataset version", [f"{r['sample_id']} has {r['dataset_version']}" for r in manifest if r["dataset_version"] != version])
    missing, dims, sums = [], [], []
    for r in manifest:
        path = root / r["image"]["path"]
        if not path.is_file():
            missing.append(r["image"]["path"])
            continue
        data = path.read_bytes()
        if data[:3] != b"\xff\xd8\xff":
            dims.append(f"{r['sample_id']} image is not a JPEG")
        with Image.open(io.BytesIO(data)) as im:
            if im.size != (r["image"]["width"], r["image"]["height"]):
                dims.append(f"{r['sample_id']} is {im.size}, manifest says {r['image']['width']}x{r['image']['height']}")
        if checksums.get(r["image"]["path"]) != hashlib.sha256(data).hexdigest():
            sums.append(f"{r['image']['path']} checksum mismatch (image replaced after generation?)")
    rep.check("every manifest entry has its image", missing)
    rep.check("image dimensions match metadata", dims)
    rep.check("images match generation checksums", sums)
    on_disk = {str(p.relative_to(root)) for p in (root / "images").rglob("*") if p.is_file()}
    rep.check("no unlisted images", [f"orphan {p}" for p in sorted(on_disk - {r["image"]["path"] for r in manifest})])
    label_files = {str(p.relative_to(root)) for p in (root / "labels").rglob("*.json")}
    rep.check("no orphan label files", [f"orphan {p}" for p in sorted(label_files - {r["labels_path"] for r in manifest})])

    # ---- labels ----
    label_problems, box_issues, poly_issues, space_issues, class_issues, vis_issues = [], [], [], [], [], []
    for r in manifest:
        sid, w, h = r["sample_id"], r["image"]["width"], r["image"]["height"]
        try:
            lab = load_label(root, r)
        except FileNotFoundError:
            label_problems.append(f"{sid} label file missing")
            continue
        if lab["sample_id"] != sid or lab["image"]["path"] != r["image"]["path"]:
            label_problems.append(f"{sid} label references {lab['sample_id']} / {lab['image']['path']}")
        if [v["instance_id"] for v in lab["vehicles"]] != [v["instance_id"] for v in r["vehicles"]]:
            label_problems.append(f"{sid} label vehicles differ from manifest")
        if [s["space_id"] for s in r["spaces"]] != SPACE_IDS or [s["space_id"] for s in lab["spaces"]] != SPACE_IDS:
            space_issues.append(f"{sid} does not label exactly {SPACE_IDS}")
        if any(s["truth"] not in ("occupied", "empty") for s in r["spaces"]):
            space_issues.append(f"{sid} has an invalid space truth")
        if r["kind"] == "settled":
            occupied = {s["space_id"] for s in r["spaces"] if s["truth"] == "occupied"}
            if occupied != set(r["scenario_params"]["base_occupancy"]):
                space_issues.append(f"{sid} settled truth differs from its layout")
        for s in lab["spaces"]:
            poly = Polygon(s["polygon_px"] or [])
            if not poly.is_valid or poly.area <= 0 or any(not (0 <= x <= w and 0 <= y <= h) for x, y in s["polygon_px"]):
                poly_issues.append(f"{sid} {s['space_id']} polygon invalid")
        for v in lab["vehicles"]:
            if v["class"] not in classes:
                class_issues.append(f"{sid} {v['instance_id']} class {v['class']}")
            box_issues += box_problems(v["bbox_amodal"], w, h, f"{sid} {v['instance_id']} amodal")
            box_issues += box_problems(v["bbox_visible"], w, h, f"{sid} {v['instance_id']} visible")
            hidden = v["occlusion"] == "hidden"
            if hidden != (v["bbox_visible"] is None) or hidden != (v["visible_pixels"] == 0):
                vis_issues.append(f"{sid} {v['instance_id']} hidden flag inconsistent")
            if not 0 <= v["visible_pixels"] <= v["unoccluded_pixels"] or not 0 <= v["visible_fraction"] <= 1:
                vis_issues.append(f"{sid} {v['instance_id']} visibility counts inconsistent")
        for o in lab["objects"]:
            box_issues += box_problems(o["bbox_amodal"], w, h, f"{sid} {o['instance_id']}")
    rep.check("every label references a valid sample", label_problems)
    rep.check("bounding boxes inside image with positive area", box_issues)
    rep.check("space polygons valid", poly_issues)
    rep.check("all 12 spaces labelled", space_issues)
    rep.check("valid vehicle classes", class_issues)
    rep.check("visibility fields consistent", vis_issues)

    # ---- splits and isolation ----
    bad_split = [f"{r['sample_id']} split {r['split']}" for r in manifest if r["split"] not in SPLITS]
    bad_split += [f"{r['sample_id']} stored outside images/{r['split']}/" for r in manifest if not r["image"]["path"].startswith(f"images/{r['split']}/")]
    rep.check("split is exactly one of train/validation/test", bad_split)
    leaks = []
    for key in ("group_id", "scenario_id", "seed"):
        splits = defaultdict(set)
        for r in manifest:
            splits[r[key]].add(r["split"])
        leaks += [f"{key} {k} in {sorted(v)}" for k, v in splits.items() if len(v) > 1]
    layouts = defaultdict(set)
    for r in manifest:
        if r["vehicles"]:
            layouts[json.dumps([r["seed"], r["scenario_params"]["base_occupancy"]], sort_keys=True)].add(r["split"])
    leaks += [f"layout {k} in {sorted(v)}" for k, v in layouts.items() if len(v) > 1]
    rep.check("no scenario/seed/layout leakage across splits", leaks)
    robust = []
    standard_groups = {r["group_id"] for r in manifest if r["subset"] == "standard"}
    standard_seeds = {r["seed"] for r in manifest if r["subset"] == "standard"}
    for r in manifest:
        if r["subset"] == "robustness":
            if r["split"] != "test":
                robust.append(f"{r['sample_id']} robustness sample in {r['split']}")
            if r["group_id"] in standard_groups or r["seed"] in standard_seeds:
                robust.append(f"{r['sample_id']} shares a group/seed with the standard set")
            if r["family"] not in ROBUSTNESS_FAMILIES:
                robust.append(f"{r['sample_id']} family {r['family']} is not a robustness family")
        elif r["family"] not in STANDARD_FAMILIES:
            robust.append(f"{r['sample_id']} robustness family outside the robustness subset")
    train_patterns = {frozenset(r["scenario_params"]["base_occupancy"]) for r in manifest if r["split"] == "train"}
    robust += [f"{r['sample_id']} row pattern also occurs in train" for r in manifest if r["family"] == "robust_row_pattern" and frozenset(r["scenario_params"]["base_occupancy"]) in train_patterns]
    rep.check("robustness set isolated", robust)

    # ---- coverage ----
    cov = []
    presets = set(config["settled"]["presets"])
    for split in SPLITS:
        seen = {r["environment"]["preset_id"] for r in manifest if r["split"] == split and r["subset"] == "standard"}
        if not presets <= seen:
            cov.append(f"{split} lacks environments {sorted(presets - seen)}")
    if not any(r["subset"] == "robustness" for r in manifest) and config["seed_groups"]["robustness"]:
        cov.append("no robustness samples")
    rep.check("expected environment coverage", cov)
    occ = []
    settled_want = {d for d, n in config["settled"]["layouts"].items() if n}
    want = settled_want | ({"empty"} if config["static_empty"]["presets"] else set())
    seen = {r["scenario_params"]["density"] for r in manifest}
    occ += [f"density {d} missing" for d in DENSITIES if d in want and d not in seen]
    for split in SPLITS:
        s = {r["scenario_params"]["density"] for r in manifest if r["split"] == split and r["family"] == "settled"}
        if not settled_want <= s:
            occ.append(f"{split} settled lacks densities {sorted(settled_want - s)}")
    rep.check("expected occupancy coverage", occ)

    # ---- production isolation ----
    prod = production_contract_problems()
    for r in manifest:
        fm = r["frame_metadata"]
        if set(fm) != FRAME_FIELDS:
            prod.append(f"{r['sample_id']} frame_metadata has fields {sorted(fm)}")
            continue
        try:
            FrameMetadata.model_validate(fm)
        except ValidationError as e:
            prod.append(f"{r['sample_id']} frame_metadata invalid: {e.errors()[0]['msg']}")
    rep.check("ground truth never in production FrameMetadata", prod)
    qa_dir = root / "qa"
    overlay = []
    image_sums = set(checksums.values())
    for p in qa_dir.rglob("*") if qa_dir.exists() else []:
        if p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() in image_sums:
            overlay.append(f"{p.name} is byte-identical to a source image")
    overlay += [f"{r['sample_id']} image path {r['image']['path']} is not a source JPEG" for r in manifest if not (r["image"]["path"].startswith("images/") and r["image"]["path"].endswith(".jpg"))]
    rep.check("overlays never substituted for source images", overlay)

    # ---- determinism ----
    if compare is not None:
        same = (root / "manifest.jsonl").read_bytes() == compare.read_bytes()
        rep.check("deterministic manifest regeneration", [] if same else [f"{compare} differs from manifest.jsonl"])
    return rep


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--compare-manifest", type=Path)
    args = parser.parse_args()
    rep = validate(args.dataset, args.compare_manifest)
    for name in rep.passed:
        print(f"PASS  {name}")
    if rep.errors:
        for e in rep.errors[:60]:
            print(f"FAIL  {e}")
        print(f"\nINVALID DATASET: {len(rep.errors)} problem(s)")
        sys.exit(1)
    print(f"\nVALID: {len(rep.passed)} checks passed")


if __name__ == "__main__":
    main()
