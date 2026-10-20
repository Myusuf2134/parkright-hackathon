"""Unpack browser evaluation bundles, score independently, and preserve reproduction inputs."""

import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
from statistics import mean

from overlay import overlay

spec = importlib.util.spec_from_file_location(
    "a0_score", Path(__file__).parents[1] / "a0-baseline/score.py"
)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def evaluate(records):
    predictions = [p for r in records for p in r["predictions"]]
    truth = [r["ground_truth"] for r in records]
    result = module.score({"predictions": predictions, "ground_truth": truth})
    ids = sorted({p["space_id"] for p in predictions})
    result["per_space"] = {
        s: module.score(
            {
                "predictions": [p for p in predictions if p["space_id"] == s],
                "ground_truth": [
                    {**f, "spaces": [v for v in f["spaces"] if v["space_id"] == s]}
                    for f in truth
                ],
            }
        )
        for s in ids
    }
    latency = sorted(r["latency_ms"] for r in records)
    result["latency_ms"] = {
        "mean": mean(latency) if latency else None,
        "p95": latency[max(0, __import__("math").ceil(0.95 * len(latency)) - 1)]
        if latency
        else None,
    }
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("bundle", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--manifest", type=Path)
    args = p.parse_args()
    data = json.loads(args.bundle.read_text())
    records = data["records"]
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = (
        json.loads(args.manifest.read_text()) if args.manifest else {"scenarios": []}
    )
    categories = {
        (s["session_id"], s["seq"]): s["category"] for s in manifest["scenarios"]
    }
    seen = set()
    files = []
    for i, r in enumerate(records):
        m = r["metadata"]
        key = (m["camera_id"], m["session_id"], m["seq"])
        if key in seen:
            raise ValueError("duplicate frame")
        seen.add(key)
        if args.manifest and (m["session_id"], m["seq"]) not in categories:
            raise ValueError("dataset and scenario manifest belong to different runs")
        if any(
            (v["camera_id"], v["session_id"], v["frame_seq"]) != key
            for v in r["predictions"]
        ):
            raise ValueError("prediction identity mismatch")
        gt = r["ground_truth"]
        if (gt["camera_id"], gt["session_id"], gt["seq"]) != key:
            raise ValueError("truth identity mismatch")
        d = r["diagnostics"]
        if d["model"]["provider"] != "a0-nvidia-ssd300":
            raise ValueError("report refuses non-real provider")
        if (
            d["error"]
            or d["frame_seq"] != m["seq"]
            or d["session_id"] != m["session_id"]
        ):
            raise ValueError("diagnostics mismatch/failure")
        folder = args.output / f"frame-{i:04d}"
        folder.mkdir(exist_ok=True)
        jpeg = base64.b64decode(r["jpeg_base64"], validate=True)
        (folder / "frame.jpg").write_bytes(jpeg)
        for field in (
            "metadata",
            "predictions",
            "ground_truth",
            "scenario",
            "diagnostics",
        ):
            (folder / f"{field}.json").write_text(json.dumps(r[field], indent=2) + "\n")
        (folder / "calibration.json").write_text(
            json.dumps(d["calibration"], indent=2) + "\n"
        )
        overlay(
            folder / "frame.jpg",
            d["calibration"],
            folder / "debug-overlay.jpg",
            d["detections"],
        )
        files.append(
            {
                "path": folder.name,
                "key": key,
                "jpeg_sha256": hashlib.sha256(jpeg).hexdigest(),
                "model": d["model"],
                "category": categories.get((m["session_id"], m["seq"]), "unclassified"),
            }
        )
    groups = sorted(set(categories.values())) or ["unclassified"]
    report = {
        "mode": "REAL NVIDIA",
        "frames": len(records),
        "omitted": data.get("omitted", 0),
        "all_categories": evaluate(records),
        "by_category": {
            g: evaluate(
                [
                    r
                    for r in records
                    if categories.get(
                        (r["metadata"]["session_id"], r["metadata"]["seq"]),
                        "unclassified",
                    )
                    == g
                ]
            )
            for g in groups
        },
        "by_lighting": {
            g: evaluate([r for r in records if r["scenario"]["preset"] == g])
            for g in sorted({r["scenario"]["preset"] for r in records})
        },
        "performance": manifest.get("performance", []),
        "difficult_viewpoint": manifest.get("difficult_viewpoint"),
        "limitations": [
            "Diagnostic set only; no held-out validation",
            "OPEN remains disabled; empty spaces are UNCERTAIN",
            "Ground truth uses vehicle centre, transition semantics differ from image overlap",
        ],
    }
    (args.output / "manifest.json").write_text(
        json.dumps(
            {"schema": "parkright-evaluation-files-v1", "frames": files}, indent=2
        )
        + "\n"
    )
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "frames": len(records),
                "metrics": {
                    k: v
                    for k, v in report["all_categories"].items()
                    if k != "per_space"
                },
                "performance": report["performance"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
