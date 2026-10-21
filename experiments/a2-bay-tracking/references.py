#!/usr/bin/env python3
"""Designate empty references from the REFERENCE split only and record their provenance.

    python experiments/a2-bay-tracking/references.py      # → ~/.cache/parkright/runs/a2-bay-tracking/references.json

The reference split is a set of calibration captures of this camera (empty lot, and partly
occupied lots so empty bays are also seen beside parked vehicles) under every lighting preset.
In a deployment an operator confirms which bays are empty in each capture; here that
confirmation is the reference split's own labels: a bay is designated empty when its truth is
empty, no vehicle footprint reaches into it and no vehicle box covers any of its polygon.
No DEV or TEST image is used, and the evidence library refuses any TEST-split provenance.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from seal import DATASET, RUNS, sha256_file  # noqa: E402

METHOD = (
    "simulator calibration capture through the production camera path; empty bays designated from reference-split "
    "labels (operator-confirmation stand-in): truth empty, no footprint intrusion, no vehicle box over the polygon"
)


def designate(dataset: Path = DATASET) -> dict:
    from shapely.geometry import Polygon, box

    from parkright_perception.evidence.frame import ReferenceProvenance, provenance_sha256

    records = [r for r in map(json.loads, (dataset / "manifest.jsonl").open()) if r["split"] == "reference"]
    if not records:
        raise SystemExit("no reference split in this dataset")
    entries = []
    for r in records:
        if r["split"] != "reference" or r["subset"] != "reference":
            raise SystemExit(f"{r['sample_id']}: not a reference capture")
        label = json.loads((dataset / r["labels_path"]).read_text())
        empty = []
        for s in label["spaces"]:
            poly = Polygon(s["polygon_px"])
            spec = next(x for x in r["spaces"] if x["space_id"] == s["space_id"])
            covered = any(v.get("bbox_amodal") and poly.intersection(box(*v["bbox_amodal"])).area > 0 for v in label["vehicles"])
            if s["truth"] == "empty" and not spec["intrusion"] and not covered:
                empty.append(s["space_id"])
        entries.append(ReferenceProvenance(
            camera_id=r["camera"]["camera_id"], calibration_version=r["camera"]["calibration_version"], source_split=r["split"],
            category="calibration_reference", image_sha256=sha256_file(dataset / r["image"]["path"]), source_id=r["sample_id"],
            method=METHOD, empty_spaces=tuple(empty),
        ))
    return {
        "schema": "parkright-empty-reference-v1",
        "dataset_manifest_sha256": sha256_file(dataset / "manifest.jsonl"),
        "references": [{**e.to_dict(), "image_path": r["image"]["path"], "preset": r["environment"]["preset_id"]} for e, r in zip(entries, records)],
        "aggregate_sha256": provenance_sha256(entries),
    }


def load(dataset: Path = DATASET, runs: Path = RUNS):
    """EmptyReference from references.json, re-checked by the library (split, image hash, camera, calibration)."""
    from parkright_perception.evidence import EmptyReference, ReferenceProvenance, ViewGeometry

    meta = json.loads((runs / "references.json").read_text())
    cal = json.loads((dataset / "calibration/cam-01.json").read_text())
    view = ViewGeometry({s: tuple((p["x"], p["y"]) for p in pts) for s, pts in cal["polygons"].items()})
    fields = set(ReferenceProvenance.__dataclass_fields__)
    captures = [
        (ReferenceProvenance(**{k: (tuple(v) if isinstance(v, list) else v) for k, v in e.items() if k in fields}), (dataset / e["image_path"]).read_bytes())
        for e in meta["references"]
    ]
    ref = EmptyReference.from_provenance(captures, view, cal["camera_id"], cal["version"])
    if ref.aggregate_sha256 != meta["aggregate_sha256"]:
        raise PermissionError("reference provenance differs from references.json")
    return cal, view, ref, meta


def main():
    out = designate()
    RUNS.mkdir(parents=True, exist_ok=True)
    (RUNS / "references.json").write_text(json.dumps(out, indent=1) + "\n")
    per = {s: sum(s in e["empty_spaces"] for e in out["references"]) for s in out["references"][0]["empty_spaces"]}
    print(json.dumps({"captures": len(out["references"]), "aggregate_sha256": out["aggregate_sha256"], "captures_per_space_min": min(per.values())}))


if __name__ == "__main__":
    main()
