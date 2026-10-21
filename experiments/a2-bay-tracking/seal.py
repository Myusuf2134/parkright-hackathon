"""Sealing for the bay-tracking evaluation (temporal v2).

FROZEN_POLICY.json is written once, after DEV selection and before any TEST inference, and
binds (SHA-256 each):

  code            evidence package + this experiment's scripts and configs (file contents)
  dataset         manifest, label checksums, image checksums, dataset config
  checkpoint      the A2 detector checkpoint file
  references      reference metadata file and the aggregate over every reference's provenance
  dev caches      DEV detections and DEV features the policy was selected on
  policy          the frozen policy itself

TEST inference, TEST features and the TEST evaluation each recompute every binding and refuse
to run if any differs. TEST_SEAL.json then binds the TEST detection and feature caches; the
single TEST evaluation verifies those too and refuses to run twice.
"""

import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATASET = Path.home() / ".cache/parkright/datasets/a2-temporal-v2-ac0f55eabd"
RUNS = Path.home() / ".cache/parkright/runs/a2-bay-tracking"
EVIDENCE = ROOT / "services/perception/src/parkright_perception/evidence"
FROZEN = HERE / "FROZEN_POLICY.json"
TEST_SEAL = HERE / "TEST_SEAL.json"
FROZEN_SCHEMA = "parkright-bay-tracking-frozen-v1"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_json(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def code_files(root: Path = ROOT) -> list[Path]:
    exp = root / "experiments/a2-bay-tracking"
    ev = root / "services/perception/src/parkright_perception/evidence"
    return sorted([*ev.glob("*.py"), *exp.glob("*.py"), *(exp / "configs").glob("*.json")])


def code_sha256(root: Path = ROOT) -> str:
    h = hashlib.sha256()
    for f in code_files(root):
        for part in (str(f.relative_to(root)).encode(), b"\0", f.read_bytes(), b"\0"):
            h.update(part)
    return h.hexdigest()


def git_commit(root: Path = ROOT) -> str | None:
    try:
        return subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def bindings(dataset: Path, runs: Path, checkpoint: Path, root: Path = ROOT) -> dict:
    refs = runs / "references.json"
    meta = json.loads(refs.read_text()) if refs.exists() else None
    return {
        "code_sha256": code_sha256(root),
        "dataset_manifest_sha256": sha256_file(dataset / "manifest.jsonl"),
        "dataset_labels_sha256": sha256_file(dataset / "labels.sha256"),
        "dataset_images_sha256": sha256_file(dataset / "checksums.sha256"),
        "dataset_config_sha256": sha256_json(json.loads((dataset / "dataset.json").read_text())["config"]),
        "checkpoint_sha256": sha256_file(checkpoint),
        "reference_metadata_sha256": sha256_file(refs) if refs.exists() else None,
        "reference_aggregate_sha256": meta["aggregate_sha256"] if meta else None,
        "dev_detections_sha256": sha256_file(runs / "detections-dev.jsonl"),
        "dev_features_sha256": sha256_file(runs / "features-dev.jsonl"),
    }


def verify(expected: dict, actual: dict) -> None:
    bad = sorted(k for k in expected if expected[k] != actual.get(k))
    if bad:
        raise PermissionError(f"TEST is sealed: bound artifacts changed: {', '.join(bad)}")


def require_frozen(frozen: Path, dataset: Path, runs: Path, checkpoint: Path, root: Path = ROOT) -> dict:
    """The frozen policy file, after checking its own integrity and every binding against disk."""
    if not Path(frozen).is_file():
        raise PermissionError("TEST is sealed: no frozen policy file")
    payload = json.loads(Path(frozen).read_text())
    if payload.get("schema") != FROZEN_SCHEMA or payload.get("status") != "frozen-before-test":
        raise PermissionError("TEST is sealed: not a frozen policy file")
    if payload.get("policy_sha256") != sha256_json(payload["policy"]):
        raise PermissionError("TEST is sealed: policy changed after freezing")
    verify(payload["bindings"], bindings(dataset, runs, checkpoint, root))
    return payload


def test_cache_bindings(runs: Path) -> dict:
    return {"test_detections_sha256": sha256_file(runs / "detections-test.jsonl"), "test_features_sha256": sha256_file(runs / "features-test.jsonl")}


def require_test_seal(seal: Path, frozen: dict, runs: Path) -> dict:
    if not Path(seal).is_file():
        raise PermissionError("TEST is sealed: no TEST_SEAL.json (run features --split test)")
    payload = json.loads(Path(seal).read_text())
    if payload.get("frozen_policy_sha256") != frozen["policy_sha256"]:
        raise PermissionError("TEST is sealed: TEST caches were sealed under a different policy")
    verify(payload["caches"], test_cache_bindings(runs))
    return payload
