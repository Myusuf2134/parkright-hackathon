#!/usr/bin/env python3
"""Evaluate frozen A0 without changing its implementation or configuration."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from PIL import Image, ImageOps
from parkright_perception.a0.nvidia_ssd import NvidiaSSD

from a2_finetune.config import load_config
from a2_finetune.dataset import load_label, load_records, sha256_file
from a2_finetune.evaluation import summarize, write_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--test-unlock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    records = load_records(args.manifest, "test", test_unlock=args.test_unlock)
    detector = NvidiaSSD(args.source, args.weights, device="cpu")
    predictions, truths, enriched, latencies = {}, {}, [], []
    for record in records:
        label = load_label(record, config.mapping())
        with Image.open(record.image_path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        started = time.perf_counter()
        result = detector.detect(image)
        latencies.append((time.perf_counter() - started) * 1000)
        boxes, labels, scores = [], [], []
        for detection in result.detections:
            if detection.label not in {"car", "bus", "truck"}:
                continue
            x1, y1, x2, y2 = detection.box
            boxes.append([x1 * record.width, y1 * record.height, x2 * record.width, y2 * record.height])
            labels.append(2 if detection.label == "truck" else 1)
            scores.append(detection.confidence)
        prediction = {"boxes": boxes, "labels": labels, "scores": scores}
        truth = {"boxes": label["boxes"], "labels": label["labels"]}
        predictions[record.sample_id] = prediction
        truths[record.sample_id] = truth
        enriched.append((record, label, prediction))
    summary = summarize(records, predictions, truths, enriched, latencies, config)
    summary.update({
        "split": "test",
        "model": detector.identity,
        "source_revision": detector.identity.split(":")[2],
        "weights_sha256": sha256_file(args.weights),
        "dataset_manifest_sha256": sha256_file(args.manifest),
        "a0_configuration": {
            "occupied_confidence": detector.config.occupied_confidence,
            "occupied_coverage": detector.config.occupied_coverage,
            "allow_open": detector.config.allow_open,
        },
    })
    write_summary(summary, args.output)
    print(json.dumps({"output": str(args.output), "images": len(records), "vehicle": summary["overall"]["detector"]["vehicle_binary"], "parking": summary["overall"]["parking"]}, indent=2))


if __name__ == "__main__":
    main()

