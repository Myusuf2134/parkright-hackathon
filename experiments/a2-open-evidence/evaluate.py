#!/usr/bin/env python3
"""OPEN-readiness evaluation (EVALUATION ONLY; production OPEN stays disabled).

    python evaluate.py features --split dev            # pixel + detection evidence per frame/space (no labels)
    python evaluate.py dev                             # DEV rule exploration + selection → DEV_SELECTION.json
    python evaluate.py freeze                          # freeze the selected rule → FROZEN_RULE.json
    python infer.py --split test --frozen FROZEN_RULE.json
    python evaluate.py features --split test --frozen FROZEN_RULE.json
    python evaluate.py test --frozen FROZEN_RULE.json  # ONE sealed TEST evaluation → RESULTS_TEST.json

Evidence is computed by the production library parkright_perception.evidence from pixels,
calibration and A2 detections only. Labels (truth, phase, occlusion) are read only to
score, after the readiness decision exists.
"""

import argparse
import itertools
import json
import sys
import time
from collections import defaultdict
from dataclasses import asdict, fields, replace
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from seal import DATASET, FROZEN_SCHEMA, RUNS, require_frozen, rule_sha256, sha256_file  # noqa: E402

CALIBRATION_VERSION = "cam-01-fixed-v1"
V1_REFERENCE = Path.home() / ".cache/parkright/datasets/a2-sim-v1-b569da957c/images/test"
REFERENCE_PRESETS = ("clear_day", "overcast", "dusk", "night")
WINDOWS = (1, 2, 3, 5)
PRIMARY_WINDOW = 5
# Thresholds explored on DEV. Feature-extraction parameters stay at EvidenceConfig defaults.
GRID = {
    "min_reference_match": (0.8, 0.85, 0.9, 0.95),
    "min_marking_visibility": (0.5, 0.6, 0.7),
    "max_interior_clutter": (0.05, 0.1),
    "max_appearance_change": (0.02, 0.04, 0.08),
    "max_vehicle_overlap": (0.0, 0.02, 0.05, 0.1),
    "motion_radius_px": (240.0, 120.0, 40.0),
    "motion_iou": (0.9, 0.8),
}
# Index step that makes each threshold looser (grids are listed strict → loose for the motion
# parameters, ascending otherwise); used for the safety-margin rule.
LOOSER = {"min_reference_match": -1, "min_marking_visibility": -1, "max_interior_clutter": 1, "max_appearance_change": 1, "max_vehicle_overlap": 1, "motion_radius_px": 1, "motion_iou": 1}


def evidence_api():
    from parkright_perception.evidence import EmptyReference, EvidenceConfig, FrameContext, TemporalTracker, ViewGeometry, frame_evidence
    from parkright_perception.evidence.frame import SpaceFrameEvidence

    return EmptyReference, EvidenceConfig, FrameContext, TemporalTracker, ViewGeometry, frame_evidence, SpaceFrameEvidence


def manifest(dataset: Path, split: str) -> list[dict]:
    return [r for r in map(json.loads, (dataset / "manifest.jsonl").open()) if r["split"] == split]


def view_and_reference(dataset: Path):
    from PIL import Image

    EmptyReference, _, _, _, ViewGeometry, _, _ = evidence_api()
    cal = json.loads((dataset / "calibration/cam-01.json").read_text())
    view = ViewGeometry({s: tuple((p["x"], p["y"]) for p in pts) for s, pts in cal["polygons"].items()})
    # Operator-confirmed empty captures of this camera (calibration-time input), one per lighting
    # condition; in simulation these are the v1 static-empty frames, which never occur in this dataset.
    refs = [V1_REFERENCE / f"static-empty-{p}.jpg" for p in REFERENCE_PRESETS]
    reference = EmptyReference.from_images([Image.open(p).convert("RGB") for p in refs], view)
    return cal, view, reference, {p.name: sha256_file(p) for p in refs}


def context(r: dict, det: dict, cal: dict):
    from parkright_perception.a2.fasterrcnn import CHECKPOINT_SHA256

    _, _, FrameContext, _, _, _, _ = evidence_api()
    m = r["frame_metadata"]
    captured = datetime.fromisoformat(m["captured_at"].replace("Z", "+00:00"))
    ctx = FrameContext(
        camera_id=m["camera_id"], session_id=m["session_id"], seq=m["seq"], captured_at=captured,
        image_sha256=det["image_sha256"], detector_ready=det["error"] is None,
        checkpoint_verified=CHECKPOINT_SHA256 in det["detector"], detector_error=det["error"],
        calibration_valid=r["camera"]["calibration_version"] == CALIBRATION_VERSION == cal["version"] and r["camera"]["pose"] == cal["pose"],
        expected_size=(cal["pose"]["width"], cal["pose"]["height"]),
    )
    # Arrival time: capture plus measured detector latency (fresh by construction).
    return ctx, captured + timedelta(milliseconds=det["latency_ms"])


def cmd_features(a):
    from PIL import Image

    if a.split == "test":
        require_frozen(a.frozen, a.dataset / "manifest.jsonl")
    _, EvidenceConfig, _, _, _, frame_evidence, _ = evidence_api()
    cal, view, reference, _ = view_and_reference(a.dataset)
    dets = {d["sample_id"]: d for d in map(json.loads, (RUNS / f"detections-{a.split}.jsonl").open())}
    records = manifest(a.dataset, a.split)
    missing = [r["sample_id"] for r in records if r["sample_id"] not in dets]
    if missing:
        raise SystemExit(f"{len(missing)} frames have no cached detections; run infer.py --split {a.split}")
    out = (RUNS / f"features-{a.split}.jsonl").open("w")
    started = time.perf_counter()
    for r in records:
        det = dets[r["sample_id"]]
        ctx, now = context(r, det, cal)
        with Image.open(a.dataset / r["image"]["path"]) as image:
            ev = frame_evidence(image.convert("RGB"), ctx, view, det["detections"], now, EvidenceConfig(), reference)
        out.write(json.dumps({"sample_id": r["sample_id"], "spaces": {s: asdict(e) for s, e in ev.items()}}) + "\n")
    out.close()
    print(f"features {a.split}: {len(records)} frames in {time.perf_counter() - started:.0f} s")


# ---- scoring (labels used only from here on) -------------------------------------------------


def ground_truth(dataset: Path, r: dict) -> dict[str, dict]:
    from shapely.geometry import Polygon, box

    label = json.loads((dataset / r["labels_path"]).read_text())
    vehicles = {v["space_id"]: v for v in label["vehicles"]}
    out = {}
    for s in label["spaces"]:
        poly = Polygon(s["polygon_px"])
        occluder = max((poly.intersection(box(*o["bbox_amodal"])).area / poly.area for o in label["objects"] if o.get("bbox_amodal")), default=0.0)
        v = vehicles.get(s["space_id"])
        phase = next((x["phase"] for x in r["spaces"] if x["space_id"] == s["space_id"]), "settled")
        out[s["space_id"]] = {
            "truth": s["truth"], "phase": phase,
            "occluded": occluder > 0 or (v is not None and v.get("occlusion") not in (None, "none")),
        }
    return out


def load_split(dataset: Path, split: str):
    _, _, _, _, _, _, SpaceFrameEvidence = evidence_api()
    names = {f.name for f in fields(SpaceFrameEvidence)}
    feats = {}
    for row in map(json.loads, (RUNS / f"features-{split}.jsonl").open()):
        feats[row["sample_id"]] = {
            s: SpaceFrameEvidence(**{k: (tuple(v) if isinstance(v, list) else v) for k, v in e.items() if k in names})
            for s, e in row["spaces"].items()
        }
        for s, e in feats[row["sample_id"]].items():
            object.__setattr__(e, "near_boxes", tuple(tuple(b) for b in e.near_boxes))
    dets = {d["sample_id"]: d for d in map(json.loads, (RUNS / f"detections-{split}.jsonl").open())}
    cal = json.loads((dataset / "calibration/cam-01.json").read_text())
    sequences = defaultdict(list)
    for r in manifest(dataset, split):
        sequences[r["sequence_id"]].append(r)
    truth = {r["sample_id"]: ground_truth(dataset, r) for rs in sequences.values() for r in rs}
    return sequences, feats, dets, cal, truth


CATEGORIES = {
    "frame": ("frame:",), "visibility": ("insufficient_visibility",), "occlusion": ("occlusion_risk", "markings_not_visible"),
    "vehicle": ("vehicle_overlap", "occupied_evidence"), "surface": ("interior_not_clear", "no_empty_reference_match"),
    "transition": ("transition_",), "temporal": ("insufficient_distinct_frames", "temporal_inconsistent", "duplicate_frame", "out_of_order_frame", "stale_frame"),
}


def observations(data, cfg, window: int) -> list[dict]:
    sequences, feats, dets, cal, truth = data
    _, _, _, TemporalTracker, _, _, _ = evidence_api()
    rows = []
    for seq_id in sorted(sequences):
        tracker = TemporalTracker(replace(cfg, window=window))
        for r in sorted(sequences[seq_id], key=lambda x: x["frame_index"]):
            ctx, now = context(r, dets[r["sample_id"]], cal)
            for sid, ev in tracker.observe(ctx, feats[r["sample_id"]], now).items():
                gt = truth[r["sample_id"]][sid]
                rows.append({
                    "sample_id": r["sample_id"], "sequence_id": seq_id, "space_id": sid, "ready": ev.open_ready, "reasons": ev.blocking_reasons,
                    "occupied_production": feats[r["sample_id"]][sid].occupied, "truth": gt["truth"], "phase": gt["phase"], "occluded": gt["occluded"],
                    "environment": r["environment"]["preset_id"], "density": r["scenario_params"]["density"], "family": r["family"],
                    "state": "settled" if gt["phase"] == "settled" else "transition", "row": "far (A)" if sid.startswith("A") else "near (B)",
                    "frame_index": r["frame_index"],
                })
    return rows


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    empty = [x for x in rows if x["truth"] == "empty"]
    occupied = [x for x in rows if x["truth"] == "occupied"]
    ready = [x for x in rows if x["ready"]]
    tp = sum(x["truth"] == "empty" for x in ready)
    fo = len(ready) - tp
    rejected = [x for x in empty if not x["ready"]]
    rej = {k: round(sum(any(r.startswith(p) for r in x["reasons"] for p in pre) for x in rejected) / len(empty), 4) if empty else None for k, pre in CATEGORIES.items()}
    return {
        "observations": n, "truth_empty": len(empty), "truth_occupied": len(occupied), "open_ready": len(ready),
        "false_open": fo, "false_open_rate": round(fo / len(occupied), 6) if occupied else None,
        "potential_open_precision": round(tp / len(ready), 6) if ready else None,
        "potential_open_recall": round(tp / len(empty), 6) if empty else None,
        "open_ready_coverage": round(len(ready) / n, 6) if n else None,
        "uncertain_rate": round(sum(not x["ready"] and not x["occupied_production"] for x in rows) / n, 6) if n else None,
        "transition_hazard": sum(x["ready"] and x["phase"] != "settled" for x in rows),
        "ready_while_occluded": sum(x["ready"] and x["occluded"] for x in rows),
        "rejection_rate_among_empty": rej,
    }


def breakdown(rows: list[dict]) -> dict:
    out = {"overall": metrics(rows)}
    for dim in ("environment", "density", "state", "family", "row"):
        groups = defaultdict(list)
        for x in rows:
            groups[x[dim]].append(x)
        out[dim] = {k: metrics(v) for k, v in sorted(groups.items())}
    return out


def false_open_cases(rows):
    return [{k: x[k] for k in ("sample_id", "space_id", "phase", "environment", "family", "occluded", "reasons")} for x in rows if x["ready"] and (x["truth"] == "occupied" or x["phase"] != "settled")]


def base_config():
    _, EvidenceConfig, _, _, _, _, _ = evidence_api()
    return EvidenceConfig()


def rule_config(rule: dict):
    return replace(base_config(), **{k: v for k, v in rule.items() if k != "window"}, max_occlusion_risk=round(1 - rule["min_marking_visibility"], 4))


def cmd_dev(a):
    data = load_split(a.dataset, "dev")
    keys = list(GRID)
    results = {}
    started = time.perf_counter()
    for combo in itertools.product(*(GRID[k] for k in keys)):
        rule = dict(zip(keys, combo))
        m = metrics(observations(data, rule_config(rule), PRIMARY_WINDOW))
        results[combo] = m
    safe = lambda m: m["false_open"] == 0 and m["transition_hazard"] == 0  # noqa: E731

    def looser_neighbours(combo):
        for i, k in enumerate(keys):
            j = GRID[k].index(combo[i]) + LOOSER[k]  # one step looser
            if 0 <= j < len(GRID[k]):
                yield combo[:i] + (GRID[k][j],) + combo[i + 1:]

    # Selection rule (fixed before any DEV result was inspected): zero false OPEN and zero
    # transition hazard on DEV, with every one-step-looser neighbour also safe (margin);
    # maximise DEV recall; ties go to the strictest combination.
    eligible = [c for c, m in results.items() if safe(m) and all(safe(results[n]) for n in looser_neighbours(c))]
    strictness = lambda c: sum(-LOOSER[k] * GRID[k].index(v) for k, v in zip(keys, c))  # noqa: E731
    selected = max(eligible, key=lambda c: (results[c]["potential_open_recall"] or 0, strictness(c)), default=None)
    summary = {
        "schema": "parkright-open-evidence-dev-v1",
        "dataset_manifest_sha256": sha256_file(a.dataset / "manifest.jsonl"),
        "grid": GRID, "primary_window": PRIMARY_WINDOW, "combinations": len(results),
        "safe_combinations": sum(safe(m) for m in results.values()), "eligible_with_margin": len(eligible),
        "selection_rule": "zero DEV false OPEN and zero transition hazard at window 5, all one-step-looser neighbours also safe, max DEV recall",
        "selected_rule": dict(zip(keys, selected)) | {"window": PRIMARY_WINDOW} if selected else None,
        "seconds": round(time.perf_counter() - started, 1),
    }
    if selected:
        rule = summary["selected_rule"]
        summary["dev_by_window"] = {w: breakdown(observations(data, rule_config(rule), w)) for w in WINDOWS}
        summary["dev_unsafe_cases_by_window"] = {w: false_open_cases(observations(data, rule_config(rule), w)) for w in WINDOWS}
    summary["most_permissive_safe"] = sorted(
        ({"rule": dict(zip(keys, c)), "recall": m["potential_open_recall"]} for c, m in results.items() if safe(m)), key=lambda x: -(x["recall"] or 0),
    )[:5]
    (HERE / "DEV_SELECTION.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(json.dumps({k: summary[k] for k in ("combinations", "safe_combinations", "eligible_with_margin", "selected_rule")}, indent=2))


def cmd_freeze(a):
    dev = json.loads((HERE / "DEV_SELECTION.json").read_text())
    if not dev.get("selected_rule"):
        raise SystemExit("no DEV-eligible rule to freeze")
    manifest_sha = sha256_file(a.dataset / "manifest.jsonl")
    if dev["dataset_manifest_sha256"] != manifest_sha:
        raise SystemExit("DEV selection was made on a different dataset")
    rule = dev["selected_rule"]
    _, _, _, refs = view_and_reference(a.dataset)
    frozen = {
        "schema": FROZEN_SCHEMA, "status": "frozen-before-test", "frozen_at": datetime.now().astimezone().isoformat(),
        "dataset_manifest_sha256": manifest_sha, "rule": rule, "rule_sha256": rule_sha256(rule),
        "evidence_config": asdict(rule_config(rule)), "reference_images_sha256": refs,
        "dev_overall_at_window": {w: dev["dev_by_window"][str(w)]["overall"] for w in WINDOWS},
    }
    target = HERE / "FROZEN_RULE.json"
    if target.exists():
        raise SystemExit("FROZEN_RULE.json already exists; the rule is frozen")
    target.write_text(json.dumps(frozen, indent=2) + "\n")
    print(f"frozen rule {frozen['rule_sha256'][:12]}: {rule}")


def cmd_test(a):
    frozen = require_frozen(a.frozen, a.dataset / "manifest.jsonl")
    target = HERE / "RESULTS_TEST.json"
    if target.exists():
        raise SystemExit("RESULTS_TEST.json exists: the sealed TEST set has already been evaluated once")
    data = load_split(a.dataset, "test")
    cfg = rule_config(frozen["rule"])
    by_window = {w: observations(data, cfg, w) for w in WINDOWS}
    result = {
        "schema": "parkright-open-evidence-test-v1", "evaluated_at": datetime.now().astimezone().isoformat(),
        "rule_sha256": frozen["rule_sha256"], "rule": frozen["rule"], "dataset_manifest_sha256": frozen["dataset_manifest_sha256"],
        "by_window": {w: breakdown(rows) for w, rows in by_window.items()},
        "unsafe_cases_by_window": {w: false_open_cases(rows) for w, rows in by_window.items()},
    }
    target.write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(json.dumps({w: {k: v for k, v in result["by_window"][w]["overall"].items() if k != "rejection_rate_among_empty"} for w in WINDOWS}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", type=Path, default=DATASET)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("features")
    f.add_argument("--split", choices=("dev", "test"), required=True)
    f.add_argument("--frozen", type=Path)
    sub.add_parser("dev")
    sub.add_parser("freeze")
    t = sub.add_parser("test")
    t.add_argument("--frozen", type=Path, required=True)
    a = p.parse_args()
    {"features": cmd_features, "dev": cmd_dev, "freeze": cmd_freeze, "test": cmd_test}[a.cmd](a)


if __name__ == "__main__":
    main()
