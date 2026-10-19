"""Publish compact, reviewable A2 report data from ignored full analyzer output."""

import argparse
import csv
import json
import shutil
from pathlib import Path


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def write_csv(path, rows):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    baseline = json.loads((args.input / "baseline.json").read_text())
    frames = json.loads((args.input / "frames.json").read_text())
    controlled = json.loads((args.input / "controlled.json").read_text())
    alternatives = json.loads((args.input / "alternatives.json").read_text())

    write_json(
        args.output / "baseline-summary.json",
        {
            key: baseline[key]
            for key in (
                "schema",
                "source_schema",
                "source_sha256",
                "model_identity",
                "baseline",
                "object_scale",
                "scale_confidence",
                "preprocessing_audit",
                "synthetic_image_metrics",
                "real_control",
            )
        },
    )
    write_json(
        args.output / "top-detections.json",
        [
            {
                "frame_id": frame["frame_id"],
                "preset": frame["preset"],
                "occupied_spaces": frame["occupied_spaces"],
                "highest_vehicle_score": frame["highest_vehicle_score"],
                "top_detections": frame["top_detections"][:5],
            }
            for frame in frames
        ],
    )
    histogram = baseline["baseline"]["vehicle_confidence_histogram"]
    write_csv(args.output / "confidence-histogram.csv", histogram)
    controlled_rows = [
        {
            "variant": name,
            "frames": value["frames"],
            "frames_with_vehicle": value["frames_with_vehicle"],
            "frames_at_or_above_0_65": value["frames_at_or_above_0.65"],
            "maximum_vehicle_score": value["maximum_vehicle_score"],
            "median_vehicle_score_when_present": value[
                "median_vehicle_score_when_present"
            ],
        }
        for name, value in controlled["variants"].items()
    ]
    crop = controlled["object_local_crops"]
    controlled_rows.append(
        {
            "variant": "object_local_crops",
            "frames": crop["crops"],
            "frames_with_vehicle": crop["crops_with_vehicle"],
            "frames_at_or_above_0_65": crop["crops_at_or_above_0.65"],
            "maximum_vehicle_score": crop["maximum_vehicle_score"],
            "median_vehicle_score_when_present": "",
        }
    )
    write_csv(args.output / "controlled-summary.csv", controlled_rows)
    alternative_rows = []
    for result in alternatives:
        gate = result["a0_gate_proxy"]
        alternative_rows.append(
            {
                "model": result["model"],
                "positive_frames": result["positive_frames"],
                "positive_frames_with_vehicle": result[
                    "positive_frames_with_vehicle"
                ],
                "highest_vehicle_score": result["highest_vehicle_score"],
                "occupied_spaces": gate["occupied_spaces"],
                "occupied_spaces_passing_a0_gate": gate[
                    "occupied_spaces_passing_gate"
                ],
                "empty_spaces": gate["empty_spaces"],
                "empty_spaces_passing_a0_gate": gate["empty_spaces_passing_gate"],
                "mean_cpu_ms": result["inference_ms"]["mean"],
                "p95_cpu_ms": result["inference_ms"]["p95"],
            }
        )
    write_csv(args.output / "alternative-summary.csv", alternative_rows)
    write_json(
        args.output / "alternative-summary.json",
        [
            {key: value for key, value in result.items() if key != "results"}
            for result in alternatives
        ],
    )
    shutil.copyfile(args.input / "object-scale.csv", args.output / "object-scale.csv")


if __name__ == "__main__":
    main()
