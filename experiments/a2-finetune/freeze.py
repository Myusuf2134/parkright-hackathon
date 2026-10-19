#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from a2_finetune.config import load_config
from a2_finetune.dataset import sha256_file


def main():
    import torch

    parser = argparse.ArgumentParser(description="Freeze A2 only after validation review; unlocks one held-out test run.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    validation = json.loads(args.validation.read_text())
    manifest_sha = sha256_file(args.manifest)
    if checkpoint["config_sha256"] != config.sha256() or checkpoint["dataset_manifest_sha256"] != manifest_sha:
        raise ValueError("checkpoint is not from this frozen config/dataset")
    if validation.get("split") != "validation" or validation.get("checkpoint_sha256") != sha256_file(args.checkpoint):
        raise ValueError("validation does not identify the selected checkpoint")
    payload = {
        "schema": "parkright-a2-frozen-v1",
        "status": "frozen-before-test",
        "dataset_version": "a2-sim-v1-b569da957c",
        "dataset_manifest_sha256": manifest_sha,
        "checkpoint": str(args.checkpoint.resolve()),
        "checkpoint_sha256": sha256_file(args.checkpoint),
        "checkpoint_size_bytes": args.checkpoint.stat().st_size,
        "checkpoint_epoch": checkpoint["epoch"],
        "selection_metric": checkpoint["selection_metric"],
        "config": config.to_dict(),
        "config_sha256": config.sha256(),
        "validation_summary_sha256": sha256_file(args.validation),
        "training_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip(),
        "test_runs_authorized": 1,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()

