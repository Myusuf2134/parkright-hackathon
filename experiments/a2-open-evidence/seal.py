"""TEST sealing for the temporal OPEN-evidence evaluation.

TEST detections and TEST metrics are produced only when a frozen rule file exists that
binds: the readiness rule (and its SHA-256), the dataset manifest SHA-256, and the DEV
result it was selected on. evaluate.py writes the TEST result once and refuses to
overwrite it.
"""

import hashlib
import json
from pathlib import Path

DATASET = Path.home() / ".cache/parkright/datasets/a2-temporal-v1-d7899ac757"
RUNS = Path.home() / ".cache/parkright/runs/a2-open-evidence"
FROZEN_SCHEMA = "parkright-open-evidence-frozen-v1"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rule_sha256(rule: dict) -> str:
    return hashlib.sha256(json.dumps(rule, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def require_frozen(frozen: Path | None, manifest: Path) -> dict:
    if frozen is None or not Path(frozen).is_file():
        raise PermissionError("TEST is sealed: pass --frozen with a frozen rule file")
    payload = json.loads(Path(frozen).read_text())
    expected = {"schema": FROZEN_SCHEMA, "status": "frozen-before-test", "dataset_manifest_sha256": sha256_file(manifest)}
    for key, value in expected.items():
        if payload.get(key) != value:
            raise PermissionError(f"TEST is sealed: frozen file {key} does not match")
    if payload.get("rule_sha256") != rule_sha256(payload["rule"]):
        raise PermissionError("TEST is sealed: rule changed after freezing")
    return payload
