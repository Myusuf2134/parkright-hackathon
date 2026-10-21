#!/usr/bin/env python3
"""Bay-tracking OPEN-readiness evaluation on temporal v2 (EVALUATION ONLY; production OPEN stays disabled).

    python references.py                          # empty references from the REFERENCE split only
    python infer.py --split dev
    python evaluate.py features --split dev       # pixel + detection evidence per frame/space (no labels)
    python evaluate.py dev                        # DEV policy comparison A–E + tracking selection → DEV_SELECTION.json
    python evaluate.py freeze                     # → FROZEN_POLICY.json (commit it before any TEST step)
    python infer.py --split test                  # refused unless every frozen binding verifies
    python evaluate.py features --split test      # refused likewise; writes TEST_SEAL.json once
    python evaluate.py test                       # ONE sealed TEST evaluation → RESULTS_TEST.json

Evidence comes from the library parkright_perception.evidence (pixels, calibration, A2 boxes
only). Labels (truth, phase, intrusion, horizon) are read only to score, after readiness exists.
detector_dropout frames have their detections removed before evidence and tracking, for DEV and
TEST alike (a simulated detector outage; scenario metadata, not ground truth).
"""

import argparse
import itertools
import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, fields, replace
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from seal import (  # noqa: E402
    DATASET, FROZEN, FROZEN_SCHEMA, RUNS, TEST_SEAL, bindings, git_commit, require_frozen, require_test_seal, sha256_json, test_cache_bindings,
)

WINDOWS = (1, 2, 3, 5)
# Surface thresholds: the v1 frozen rule (a2-open-evidence FROZEN_RULE.json), unchanged, so the
# gates differ only in transition handling.
SURFACE = {"min_reference_match": 0.95, "min_marking_visibility": 0.6, "max_interior_clutter": 0.05, "max_appearance_change": 0.02, "max_vehicle_overlap": 0.0}
# Baselines. A is the v1 frozen rule as it actually executed (radius capped at 300 px by the
# neighbourhood prefilter); B is the same rule with the documented 360 px radius really applied.
BASELINES = {
    "A_coarse_frozen_effective_300": {"gate": "coarse", **SURFACE, "motion_radius_px": 300.0, "motion_iou": 0.9, "window": 5},
    "B_coarse_corrected_360": {"gate": "coarse", **SURFACE, "motion_radius_px": 360.0, "motion_iou": 0.9, "window": 5},
}
# DEV iteration history (TEST untouched throughout): see DEV_ITERATION notes in DEV_SELECTION.json.
DEV_ITERATION = 1
# Tracking grid explored on DEV, each listed strict → loose. Selection uses one-step-looser neighbours.
GRID = {
    "speed_floor_px_s": (10.0, 20.0, 40.0),
    "path_margin_px": (20.0, 10.0, 0.0),
    "near_px": (40.0, 25.0, 10.0),
    "uncertain_near_px": (90.0, 60.0, 30.0),
    "lost_cooldown_ms": (3000.0, 1500.0, 0.0),
    "window": (5, 3, 2),
}
FIXED_TRACKING = {"approach_latch_ms": 1500.0, "horizon_ms": 3000.0, "min_cos": 0.0}
SELECTION_RULE = (
    "tracking gate; zero DEV false OPEN and zero DEV transition hazard; every one-step-looser grid neighbour also has zero of both "
    "(margin); maximise DEV potential-OPEN recall; ties → strictest"
)


def api():
    from parkright_perception import evidence as ev
    from parkright_perception.evidence.frame import SpaceFrameEvidence

    return ev, SpaceFrameEvidence


def manifest(split: str) -> list[dict]:
    return [r for r in map(json.loads, (DATASET / "manifest.jsonl").open()) if r["split"] == split]


def checkpoint():
    from parkright_perception.a2.provider import DEFAULT_CHECKPOINT

    return DEFAULT_CHECKPOINT


def detections_for(r: dict, det: dict) -> list[dict]:
    """Cached A2 detections, with the scenario's simulated detector outage applied."""
    return [] if r["frame_index"] in r["scenario_params"]["dropout_frames"] else det["detections"]


def context(r: dict, det: dict, cal: dict):
    from parkright_perception.a2.fasterrcnn import CHECKPOINT_SHA256

    ev, _ = api()
    m = r["frame_metadata"]
    captured = datetime.fromisoformat(m["captured_at"].replace("Z", "+00:00"))
    ctx = ev.FrameContext(
        camera_id=m["camera_id"], session_id=m["session_id"], seq=m["seq"], captured_at=captured, image_sha256=det["image_sha256"],
        detector_ready=det["error"] is None, checkpoint_verified=CHECKPOINT_SHA256 in det["detector"], detector_error=det["error"],
        calibration_valid=r["camera"]["calibration_version"] == cal["version"] and r["camera"]["pose"] == cal["pose"],
        expected_size=(cal["pose"]["width"], cal["pose"]["height"]),
    )
    return ctx, captured + timedelta(milliseconds=det["latency_ms"])


def cmd_features(a):
    from PIL import Image

    from references import load

    if a.split == "test":
        frozen = require_frozen(FROZEN, DATASET, RUNS, checkpoint())
        if TEST_SEAL.exists():
            raise SystemExit("TEST_SEAL.json exists: TEST features were already computed and sealed")
    ev, _ = api()
    cal, view, reference, _ = load()
    dets = {d["sample_id"]: d for d in map(json.loads, (RUNS / f"detections-{a.split}.jsonl").open())}
    records = manifest(a.split)
    missing = [r["sample_id"] for r in records if r["sample_id"] not in dets]
    if missing:
        raise SystemExit(f"{len(missing)} frames have no cached detections; run infer.py --split {a.split}")
    started = time.perf_counter()
    with (RUNS / f"features-{a.split}.jsonl").open("w") as out:
        for r in records:
            det = dets[r["sample_id"]]
            ctx, now = context(r, det, cal)
            with Image.open(DATASET / r["image"]["path"]) as image:
                e = ev.frame_evidence(image.convert("RGB"), ctx, view, detections_for(r, det), now, ev.EvidenceConfig(), reference)
            out.write(json.dumps({"sample_id": r["sample_id"], "spaces": {s: asdict(x) for s, x in e.items()}}) + "\n")
    print(f"features {a.split}: {len(records)} frames in {time.perf_counter() - started:.0f} s")
    if a.split == "test":
        seal = {"schema": "parkright-bay-tracking-test-seal-v1", "sealed_at": datetime.now().astimezone().isoformat(),
                "frozen_policy_sha256": frozen["policy_sha256"], "caches": test_cache_bindings(RUNS)}
        TEST_SEAL.write_text(json.dumps(seal, indent=2) + "\n")
        print(f"sealed TEST caches: {seal['caches']}")


# ---- scoring (labels used only from here on) -------------------------------------------------


def load_split(split: str):
    _, SpaceFrameEvidence = api()
    names = {f.name for f in fields(SpaceFrameEvidence)}
    feats = {}
    for row in map(json.loads, (RUNS / f"features-{split}.jsonl").open()):
        feats[row["sample_id"]] = {
            s: SpaceFrameEvidence(**{k: (tuple(tuple(b) for b in v) if k == "near_boxes" else tuple(v) if isinstance(v, list) else v) for k, v in e.items() if k in names})
            for s, e in row["spaces"].items()
        }
    dets = {d["sample_id"]: d for d in map(json.loads, (RUNS / f"detections-{split}.jsonl").open())}
    cal = json.loads((DATASET / "calibration/cam-01.json").read_text())
    sequences = defaultdict(list)
    for r in manifest(split):
        sequences[r["sequence_id"]].append(r)
    for rs in sequences.values():
        rs.sort(key=lambda x: x["frame_index"])
    return sequences, feats, dets, cal


def configs(policy: dict):
    ev, _ = api()
    surface = {k: policy[k] for k in SURFACE}
    radius = policy.get("motion_radius_px", 40.0)
    cfg = replace(ev.EvidenceConfig(), **surface, max_occlusion_risk=round(1 - policy["min_marking_visibility"], 4), motion_radius_px=radius,
                  motion_iou=policy.get("motion_iou", 0.9), window=policy["window"])
    if policy["gate"] == "coarse":
        return cfg, None
    t = {k: policy[k] for k in policy if k in ev.TrackingConfig.__dataclass_fields__}
    return cfg, replace(ev.TrackingConfig(), **t)


def observations(data, policy: dict, windows=None) -> dict[int, list[dict]]:
    """Runs the library tracker at the policy window; rows per window ≤ that window are derived from its state.

    Derived windows replicate TemporalTracker._space exactly (checked by ``verify_windows``).
    """
    sequences, feats, dets, cal = data
    ev, _ = api()
    cfg, tracking = configs(policy)
    view = ev.ViewGeometry({s: tuple((p["x"], p["y"]) for p in pts) for s, pts in cal["polygons"].items()})
    windows = windows or [policy["window"]]
    out = {w: [] for w in windows}
    for seq_id in sorted(sequences):
        tracker = ev.TemporalTracker(cfg, tracking, view if tracking else None)
        for r in sequences[seq_id]:
            det = dets[r["sample_id"]]
            ctx, now = context(r, det, cal)
            spaces = feats[r["sample_id"]]
            res = tracker.observe(ctx, spaces, now, detections_for(r, det) if tracking else None)
            win = list(tracker.window)
            for sid, e in res.items():
                truth = next(x for x in r["spaces"] if x["space_id"] == sid)
                base = {
                    "sample_id": r["sample_id"], "sequence_id": seq_id, "space_id": sid, "truth": truth["truth"], "phase": truth["phase"],
                    "intrusion": truth["intrusion"], "soon": truth["occupied_within_horizon"], "role": truth["role"],
                    "occupied_production": spaces[sid].occupied, "environment": r["environment"]["preset_id"], "density": r["scenario_params"]["density"],
                    "family": r["family"], "row": "far (A)" if sid.startswith("A") else "near (B)", "frame_index": r["frame_index"],
                    "bay_motion": e.bay_motion, "dropout": r["frame_index"] in r["scenario_params"]["dropout_frames"],
                }
                for w in windows:
                    if w == policy["window"]:
                        ready, reasons = e.open_ready, e.blocking_reasons
                    else:
                        ready, reasons = _derived(e, spaces[sid], win, sid, w, cfg)
                    out[w].append({**base, "ready": ready, "reasons": reasons})
    return out


def _derived(e, current, win, sid, w, cfg):
    recent = win[-w:]
    frame_block = [x for x in e.blocking_reasons if x in ("out_of_order_frame", "non_monotonic_timestamp", "stale_frame", "duplicate_frame")]
    passing = [x for x in recent if sid in x.spaces and not x.spaces[sid].blocking(cfg)]
    states = [x.state.get(sid, "suspected") for x in recent]
    transition = "unknown" if len(win) < 2 else next((s for s in reversed(states) if s != "settled"), "settled")
    reasons = frame_block + current.blocking(cfg)
    if len(win) < w:
        reasons.append("insufficient_distinct_frames")
    elif len(passing) < w:
        reasons.append("temporal_inconsistent")
    if transition != "settled":
        reasons.append(f"transition_{transition}")
    reasons = tuple(dict.fromkeys(reasons))
    return not reasons, reasons


def verify_windows(data, policy):
    """Readiness derived for windows 3/2/1 from a window-5 run equals running the library tracker at that window."""
    derived = observations(data, {**policy, "window": 5}, [5, 3, 2, 1])
    for w in (3, 2, 1):
        direct = observations(data, {**policy, "window": w})[w]
        if [(x["ready"], x["reasons"]) for x in direct] != [(x["ready"], x["reasons"]) for x in derived[w]]:
            raise AssertionError(f"derived window {w} differs from the library tracker")


CATEGORIES = {
    "frame": ("frame:",), "visibility": ("insufficient_visibility",), "occlusion": ("occlusion_risk", "markings_not_visible"),
    "vehicle": ("vehicle_overlap", "occupied_evidence"), "surface": ("interior_not_clear", "no_empty_reference_match"),
    "transition": ("transition_",), "temporal": ("insufficient_distinct_frames", "temporal_inconsistent", "duplicate_frame", "out_of_order_frame", "stale_frame", "non_monotonic_timestamp"),
}
TRANSITIONS = ("approaching", "departing", "ambiguous", "lost", "suspected", "unknown")


def hazard(x) -> bool:
    return x["ready"] and x["truth"] == "empty" and (x["phase"] != "settled" or x["intrusion"] or x["soon"])


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    empty = [x for x in rows if x["truth"] == "empty"]
    occupied = [x for x in rows if x["truth"] == "occupied"]
    ready = [x for x in rows if x["ready"]]
    tp = sum(x["truth"] == "empty" for x in ready)
    fo = len(ready) - tp
    rejected = [x for x in empty if not x["ready"]]
    pct = lambda k: round(k / len(empty), 4) if empty else None  # noqa: E731
    prod_tp = sum(x["occupied_production"] and x["truth"] == "occupied" for x in rows)
    prod_pos = sum(x["occupied_production"] for x in rows)
    return {
        "observations": n, "truth_empty": len(empty), "truth_occupied": len(occupied), "open_ready": len(ready),
        "false_open": fo, "false_open_rate": round(fo / len(occupied), 6) if occupied else None,
        "transition_hazard": sum(hazard(x) for x in rows),
        "potential_open_precision": round(tp / len(ready), 6) if ready else None,
        "potential_open_recall": round(tp / len(empty), 6) if empty else None,
        "open_ready_coverage": round(len(ready) / n, 6) if n else None,
        "uncertain_rate": round(sum(not x["ready"] and not x["occupied_production"] for x in rows) / n, 6) if n else None,
        "occupied_precision": round(prod_tp / prod_pos, 6) if prod_pos else None,
        "occupied_recall": round(prod_tp / len(occupied), 6) if occupied else None,
        "rejection_rate_among_empty": {k: pct(sum(any(r.startswith(p) for r in x["reasons"] for p in pre) for x in rejected)) for k, pre in CATEGORIES.items()},
        "transition_reason_among_empty": {t: pct(sum(f"transition_{t}" in x["reasons"] for x in rejected)) for t in TRANSITIONS},
    }


def breakdown(rows: list[dict]) -> dict:
    out = {"overall": metrics(rows)}
    for dim in ("environment", "density", "family", "row", "role"):
        groups = defaultdict(list)
        for x in rows:
            groups[x[dim]].append(x)
        out[dim] = {k: metrics(v) for k, v in sorted(groups.items())}
    out["state"] = {k: metrics([x for x in rows if (x["phase"] == "settled") == (k == "settled")]) for k in ("settled", "transition")}
    out["cases"] = {
        "pass_by": metrics([x for x in rows if x["family"] == "pass_by"]),
        "neighbor_bays": metrics([x for x in rows if x["family"] == "neighbor_approach" and x["role"] == "neighbor"]),
        "neighbor_target": metrics([x for x in rows if x["family"] == "neighbor_approach" and x["role"] == "target"]),
        "track_loss_all": metrics([x for x in rows if x["family"] in ("detector_dropout", "occluded_approach")]),
        "track_loss_targets_and_neighbours": metrics([x for x in rows if x["family"] in ("detector_dropout", "occluded_approach") and x["role"] != "other"]),
        "dropout_frames": metrics([x for x in rows if x["dropout"]]),
        "aborted_target": metrics([x for x in rows if x["family"] == "aborted_approach" and x["role"] == "target"]),
        "pause_target": metrics([x for x in rows if x["family"] == "pause_near" and x["role"] == "target"]),
        "two_vehicles": metrics([x for x in rows if x["family"] == "two_vehicles"]),
    }
    return out


def unsafe_cases(rows):
    keys = ("sample_id", "space_id", "truth", "phase", "intrusion", "soon", "environment", "family", "role", "bay_motion", "reasons")
    return [{k: x[k] for k in keys} for x in rows if x["ready"] and (x["truth"] == "occupied" or hazard(x))]


def safe(m) -> bool:
    return m["false_open"] == 0 and m["transition_hazard"] == 0


def _policy(combo, ref):
    return {"gate": "tracking", **SURFACE, "min_reference_match": ref, **FIXED_TRACKING, **dict(zip(GRID, combo))}


_DATA = None


def _work(args):
    combo, ref = args
    global _DATA
    if _DATA is None:
        _DATA = load_split("dev")
    p = _policy(combo, ref)
    return combo, ref, metrics(observations(_DATA, p)[p["window"]])


def cmd_dev(a):
    data = load_split("dev")
    started = time.perf_counter()
    comparison = {}
    for name, p in BASELINES.items():
        comparison[name] = {"policy": p, "by_window": {w: metrics(r) for w, r in observations(data, {**p, "window": 5}, [5, 3, 2, 1]).items()}}
    keys = list(GRID)
    combos = list(itertools.product(*(GRID[k] for k in keys)))
    refs = (SURFACE["min_reference_match"],)
    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        results = {(c, r): m for c, r, m in pool.map(_work, [(c, r) for c in combos for r in refs], chunksize=4)}

    def looser(combo):
        for i, k in enumerate(keys):
            j = GRID[k].index(combo[i]) + 1
            if j < len(GRID[k]):
                yield combo[:i] + (GRID[k][j],) + combo[i + 1:]

    ref = refs[0]
    eligible = [c for c in combos if safe(results[(c, ref)]) and all(safe(results[(n, ref)]) for n in looser(c))]
    strictness = lambda c: -sum(GRID[k].index(v) for k, v in zip(keys, c))  # noqa: E731
    selected = max(eligible, key=lambda c: (results[(c, ref)]["potential_open_recall"] or 0, strictness(c)), default=None)
    by_param = {k: {str(v): {"combos": sum(1 for c in combos if c[i] == v), "safe": sum(1 for c in combos if c[i] == v and safe(results[(c, ref)]))} for v in GRID[k]} for i, k in enumerate(keys)}
    summary = {
        "schema": "parkright-bay-tracking-dev-v1", "iteration": DEV_ITERATION, "dataset": DATASET.name,
        "surface_thresholds": SURFACE, "fixed_tracking": FIXED_TRACKING, "grid": GRID, "selection_rule": SELECTION_RULE,
        "combinations": len(combos), "safe_combinations": sum(safe(results[(c, ref)]) for c in combos), "eligible_with_margin": len(eligible),
        "safety_by_parameter_value": by_param, "baselines": comparison,
        "selected_policy": _policy(selected, ref) if selected else None,
        "most_permissive_safe": sorted(({"policy": dict(zip(keys, c)), "recall": results[(c, ref)]["potential_open_recall"]} for c in combos if safe(results[(c, ref)])), key=lambda x: -(x["recall"] or 0))[:8],
        "least_unsafe": sorted(({"policy": dict(zip(keys, c)), "false_open": results[(c, ref)]["false_open"], "hazard": results[(c, ref)]["transition_hazard"], "recall": results[(c, ref)]["potential_open_recall"]} for c in combos if not safe(results[(c, ref)])), key=lambda x: (x["false_open"] + x["hazard"], -(x["recall"] or 0)))[:8],
    }
    if selected:
        p = summary["selected_policy"]
        verify_windows(data, {**p, "window": 5})
        five = observations(data, {**p, "window": 5}, [5, 3, 2, 1])
        nocool = observations(data, {**p, "window": 5, "lost_cooldown_ms": 0.0}, [5, 3, 2, 1])
        summary["comparison"] = {
            **{k: {w: v["by_window"][w] for w in (5, 3, 2, 1)} for k, v in comparison.items()},
            "C_tracking_no_cooldown": {w: metrics(nocool[w]) for w in (5, 3, 2, 1)},
            "D_tracking_with_cooldown": {w: metrics(five[w]) for w in (5, 3, 2, 1)},
        }
        summary["E_selected_by_window"] = {w: breakdown(five[w]) for w in (5, 3, 2, 1)}
        summary["selected_dev_unsafe_cases_by_window"] = {w: unsafe_cases(five[w]) for w in (5, 3, 2, 1)}
    summary["seconds"] = round(time.perf_counter() - started, 1)
    (HERE / "DEV_SELECTION.json").write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(json.dumps({k: summary[k] for k in ("combinations", "safe_combinations", "eligible_with_margin", "selected_policy", "seconds")}, indent=2, default=str))
    for name, v in comparison.items():
        print(name, {w: (m["false_open"], m["transition_hazard"], m["open_ready_coverage"]) for w, m in v["by_window"].items()})
    if selected:
        for k in ("C_tracking_no_cooldown", "D_tracking_with_cooldown"):
            print(k, {w: (m["false_open"], m["transition_hazard"], m["open_ready_coverage"]) for w, m in summary["comparison"][k].items()})


def cmd_freeze(a):
    if FROZEN.exists():
        raise SystemExit("FROZEN_POLICY.json already exists; the policy is frozen")
    dev = json.loads((HERE / "DEV_SELECTION.json").read_text())
    if not dev.get("selected_policy"):
        raise SystemExit("no DEV-eligible policy to freeze")
    policy = dev["selected_policy"]
    cfg, tracking = configs(policy)
    frozen = {
        "schema": FROZEN_SCHEMA, "status": "frozen-before-test", "frozen_at": datetime.now().astimezone().isoformat(),
        "code_revision_git_commit": git_commit(), "policy": policy, "policy_sha256": sha256_json(policy),
        "evidence_config": asdict(cfg), "tracking_config": {k: (sorted(v) if isinstance(v, frozenset) else v) for k, v in asdict(tracking).items()},
        "evidence_config_sha256": sha256_json(asdict(cfg)),
        "bindings": bindings(DATASET, RUNS, checkpoint()),
        "dev_selection_sha256": sha256_json(dev),
        "dev_by_window": {w: dev["E_selected_by_window"][str(w)]["overall"] for w in (5, 3, 2, 1)},
    }
    FROZEN.write_text(json.dumps(frozen, indent=2, default=str) + "\n")
    print(f"frozen policy {frozen['policy_sha256'][:12]} at code {frozen['code_revision_git_commit']}: {policy}")


def cmd_test(a):
    frozen = require_frozen(FROZEN, DATASET, RUNS, checkpoint())
    require_test_seal(TEST_SEAL, frozen, RUNS)
    target = HERE / "RESULTS_TEST.json"
    if target.exists():
        raise SystemExit("RESULTS_TEST.json exists: the sealed TEST set has already been evaluated once")
    data = load_split("test")
    policy = frozen["policy"]
    rows = observations(data, {**policy, "window": 5}, [5, 3, 2, 1]) if policy["window"] <= 5 else observations(data, policy)
    lat = sorted(d["latency_ms"] for d in data[2].values())
    result = {
        "schema": "parkright-bay-tracking-test-v1", "evaluated_at": datetime.now().astimezone().isoformat(),
        "policy_sha256": frozen["policy_sha256"], "policy": policy, "primary_window": policy["window"],
        "bindings_verified": frozen["bindings"], "test_seal": json.loads(TEST_SEAL.read_text())["caches"],
        "by_window": {w: breakdown(r) for w, r in rows.items()},
        "unsafe_cases_by_window": {w: unsafe_cases(r) for w, r in rows.items()},
        "a2_latency_ms": {"frames": len(lat), "mean": round(sum(lat) / len(lat), 1), "median": lat[len(lat) // 2], "p95": lat[int(len(lat) * 0.95)]},
    }
    target.write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(json.dumps({w: {k: v for k, v in result["by_window"][w]["overall"].items() if not isinstance(v, dict)} for w in rows}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("features")
    f.add_argument("--split", choices=("dev", "test"), required=True)
    d = sub.add_parser("dev")
    d.add_argument("--workers", type=int, default=6)
    sub.add_parser("freeze")
    sub.add_parser("test")
    a = p.parse_args()
    {"features": cmd_features, "dev": cmd_dev, "freeze": cmd_freeze, "test": cmd_test}[a.cmd](a)


if __name__ == "__main__":
    main()
