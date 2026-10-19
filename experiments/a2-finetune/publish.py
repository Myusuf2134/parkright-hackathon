#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def compact(metrics):
    detector = metrics["overall"]["detector"]["vehicle_binary"]
    parking = metrics["overall"]["parking"]
    latency = metrics["latency_ms"]
    return {
        "images": metrics["overall"]["images"],
        "detector": detector,
        "parking": parking,
        "latency_ms": latency,
    }


def row(name, metrics):
    d, p, latency = metrics["detector"], metrics["parking"], metrics.get("latency_ms", {})
    latency_text = f"{latency['mean']:.1f}" if "mean" in latency else "—"
    return (
        f"| {name} | {d['precision']:.4f} | {d['recall']:.4f} | {d['ap50']:.4f} | "
        f"{d['map_50_95']:.4f} | {p['occupied_precision']:.4f} | "
        f"{p['occupied_recall']:.4f} | {p['space_policy_accuracy']:.4f} | "
        f"{p['uncertain_rate']:.4f} | {latency_text} |"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--freeze", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test-a2", type=Path, required=True)
    parser.add_argument("--test-a0", type=Path, required=True)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--markdown-output", type=Path, required=True)
    args = parser.parse_args()
    provenance = json.loads(args.provenance.read_text())
    frozen = json.loads(args.freeze.read_text())
    validation = json.loads(args.validation.read_text())
    test_a2 = json.loads(args.test_a2.read_text())
    test_a0 = json.loads(args.test_a0.read_text())
    result = {
        "schema": "parkright-a2-final-results-v1",
        "dataset_version": frozen["dataset_version"],
        "dataset_manifest_sha256": frozen["dataset_manifest_sha256"],
        "training_commit": provenance["training_commit"],
        "config_sha256": frozen["config_sha256"],
        "checkpoint": {
            "path": frozen["checkpoint"],
            "sha256": frozen["checkpoint_sha256"],
            "size_bytes": frozen["checkpoint_size_bytes"],
            "epoch": frozen["checkpoint_epoch"],
            "selection_metric": frozen["selection_metric"],
        },
        "training_duration_seconds": provenance["duration_seconds"],
        "framework": {key: provenance[key] for key in ("torch", "torchvision", "python", "platform", "device")},
        "source_weights_sha256": provenance["source_weights_sha256"],
        "config": frozen["config"],
        "validation": compact(validation),
        "test": {"a2": compact(test_a2), "a0": compact(test_a0)},
        "test_breakdowns": test_a2["breakdowns"],
        "test_protocol_deviation": "Before tooling existed, a schema probe displayed the first manifest record (static-empty test metadata, no test image). It was quarantined and did not influence configuration or checkpoint selection.",
        "open_policy": "disabled; production false OPEN is structurally zero",
    }
    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    lines = [
        "# ParkRight A2 fine-tuning results",
        "",
        f"Dataset `{result['dataset_version']}`; manifest `{result['dataset_manifest_sha256']}`. ",
        f"Selected epoch {frozen['checkpoint_epoch']} by validation vehicle mAP@0.50:0.95. ",
        "TEST was evaluated only after the model, checkpoint, mapping, preprocessing, thresholds, and ROI logic were frozen.",
        "",
        "| Evaluation | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        row("Validation A2", result["validation"]),
        row("TEST A0", result["test"]["a0"]),
        row("TEST A2", result["test"]["a2"]),
        "",
        "`Space policy acc` treats correct OCCUPIED calls and policy-safe UNCERTAIN calls on empty spaces as correct because OPEN remained disabled. Production false OPEN is zero by construction. The machine-readable report includes the separately labeled naive absence-as-OPEN diagnostic.",
        "",
        "## Held-out A2 breakdowns",
        "",
    ]
    for dimension in ("environment", "subset", "kind", "family"):
        lines += [f"### {dimension}", "", "| Group | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for name, values in test_a2["breakdowns"][dimension].items():
            compact_value = {"detector": values["detector"]["vehicle_binary"], "parking": values["parking"]}
            lines.append(row(name, compact_value))
        lines.append("")
    lines += [
        "## Protocol note",
        "",
        result["test_protocol_deviation"],
        "",
        "No post-TEST tuning was performed. Further model changes require a new held-out test set.",
    ]
    args.markdown_output.write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
