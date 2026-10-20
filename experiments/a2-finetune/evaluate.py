#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from a2_finetune.config import load_config
from a2_finetune.dataset import load_records, sha256_file
from a2_finetune.evaluation import evaluate, write_summary
from a2_finetune.model import build_model, load_checkpoint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--split", choices=("validation", "test"), required=True)
    parser.add_argument("--test-unlock", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    records = load_records(args.manifest, args.split, test_unlock=args.test_unlock)
    model = build_model(config, pretrained=False)
    checkpoint = load_checkpoint(model, args.checkpoint)
    if checkpoint["config_sha256"] != config.sha256():
        raise ValueError("checkpoint/config mismatch")
    if checkpoint["dataset_manifest_sha256"] != sha256_file(args.manifest):
        raise ValueError("checkpoint/dataset mismatch")
    summary = evaluate(model, records, config)
    summary.update({
        "split": args.split,
        "checkpoint": str(args.checkpoint.resolve()),
        "checkpoint_sha256": sha256_file(args.checkpoint),
        "config_sha256": config.sha256(),
        "dataset_manifest_sha256": sha256_file(args.manifest),
    })
    write_summary(summary, args.output)
    print(json.dumps({"output": str(args.output), "images": len(records), "vehicle": summary["overall"]["detector"]["vehicle_binary"], "parking": summary["overall"]["parking"]}, indent=2))


if __name__ == "__main__":
    main()

