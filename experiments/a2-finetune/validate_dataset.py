#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from a2_finetune.config import load_config
from a2_finetune.dataset import load_label, load_records, sha256_file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    split_records = {split: load_records(args.manifest, split) for split in ("train", "validation")}
    seeds = {split: {record.seed for record in records} for split, records in split_records.items()}
    leakage = seeds["train"] & seeds["validation"]
    if leakage:
        raise ValueError(f"scene seed leakage: {sorted(leakage)}")
    output = {
        "schema": "parkright-a2-dataset-validation-v1",
        "dataset_version": "a2-sim-v1-b569da957c",
        "manifest_sha256": sha256_file(args.manifest),
        "splits": {},
        "train_validation_seed_overlap": [],
    }
    for split, records in split_records.items():
        classes, environments, families, instances = Counter(), Counter(), Counter(), 0
        for record in records:
            label = load_label(record, config.mapping())
            classes.update(label["original_classes"])
            environments[record.environment] += 1
            families[record.family] += 1
            instances += len(label["boxes"])
        output["splits"][split] = {
            "images": len(records),
            "scene_seeds": len(seeds[split]),
            "instances": instances,
            "classes": dict(sorted(classes.items())),
            "environments": dict(sorted(environments.items())),
            "families": dict(sorted(families.items())),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

