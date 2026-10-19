"""Shared loading for the OFFLINE A2 simulator dataset (canonical format: manifest.jsonl)."""

import json
from pathlib import Path

SPACE_IDS = [f"{row}{i}" for row in "AB" for i in range(1, 7)]
SPLITS = ("train", "validation", "test")
STANDARD_FAMILIES = {"static_empty", "settled", "occlusion", "transition"}
ROBUSTNESS_FAMILIES = {"robust_pillar", "robust_large_vehicles", "robust_row_pattern"}
DENSITIES = ("empty", "sparse", "medium", "dense", "full")


def load_manifest(root: Path) -> list[dict]:
    lines = (root / "manifest.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def load_dataset(root: Path) -> dict:
    return json.loads((root / "dataset.json").read_text())


def load_label(root: Path, record: dict) -> dict:
    return json.loads((root / record["labels_path"]).read_text())


def load_checksums(root: Path) -> dict[str, str]:
    out = {}
    for line in (root / "checksums.sha256").read_text().splitlines():
        digest, path = line.split("  ", 1)
        out[path] = digest
    return out
