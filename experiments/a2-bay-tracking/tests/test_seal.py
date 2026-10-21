"""The bay-tracking TEST seal refuses any change to a bound artifact (tests 17–22)."""

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import seal  # noqa: E402


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "repo"
    ev = root / "services/perception/src/parkright_perception/evidence"
    exp = root / "experiments/a2-bay-tracking"
    (exp / "configs").mkdir(parents=True)
    ev.mkdir(parents=True)
    (ev / "temporal.py").write_text("x = 1\n")
    (exp / "evaluate.py").write_text("y = 2\n")
    (exp / "configs/a2-temporal-v2.json").write_text("{}\n")
    data = tmp_path / "dataset"
    data.mkdir()
    for name, text in {"manifest.jsonl": "{}\n", "labels.sha256": "a\n", "checksums.sha256": "b\n", "dataset.json": json.dumps({"config": {"k": 1}})}.items():
        (data / name).write_text(text)
    runs = tmp_path / "runs"
    runs.mkdir()
    for name in ("detections-dev.jsonl", "features-dev.jsonl", "detections-test.jsonl", "features-test.jsonl"):
        (runs / name).write_text(f"{name}\n")
    (runs / "references.json").write_text(json.dumps({"aggregate_sha256": "r" * 64}))
    ckpt = tmp_path / "best.pt"
    ckpt.write_bytes(b"weights")
    policy = {"gate": "tracking", "window": 5}
    frozen = {
        "schema": seal.FROZEN_SCHEMA, "status": "frozen-before-test", "policy": policy, "policy_sha256": seal.sha256_json(policy),
        "bindings": seal.bindings(data, runs, ckpt, root),
    }
    fp = tmp_path / "FROZEN_POLICY.json"
    fp.write_text(json.dumps(frozen))
    test_seal = tmp_path / "TEST_SEAL.json"
    test_seal.write_text(json.dumps({"frozen_policy_sha256": frozen["policy_sha256"], "caches": seal.test_cache_bindings(runs)}))
    return {"root": root, "ev": ev, "exp": exp, "data": data, "runs": runs, "ckpt": ckpt, "frozen": fp, "seal": test_seal}


def check(t):
    payload = seal.require_frozen(t["frozen"], t["data"], t["runs"], t["ckpt"], t["root"])
    seal.require_test_seal(t["seal"], payload, t["runs"])


def test_unchanged_artifacts_pass(tree):
    check(tree)


def test_missing_frozen_file_is_refused(tree):
    tree["frozen"].unlink()
    with pytest.raises(PermissionError, match="no frozen policy"):
        check(tree)


def test_policy_edited_after_freezing_is_refused(tree):
    payload = json.loads(tree["frozen"].read_text())
    payload["policy"]["window"] = 2
    tree["frozen"].write_text(json.dumps(payload))
    with pytest.raises(PermissionError, match="policy changed"):
        check(tree)


# 18. code revision
@pytest.mark.parametrize("rel", ["ev/temporal.py", "exp/evaluate.py", "exp/configs/a2-temporal-v2.json", "ev/new_module.py"])
def test_changed_code_is_refused(tree, rel):
    base, name = rel.split("/", 1)
    (tree[base] / name).write_text("changed\n")
    with pytest.raises(PermissionError, match="code_sha256"):
        check(tree)


# 19. reference hashes
def test_changed_references_are_refused(tree):
    (tree["runs"] / "references.json").write_text(json.dumps({"aggregate_sha256": "s" * 64}))
    with pytest.raises(PermissionError, match="reference_aggregate_sha256"):
        check(tree)


# 20. checkpoint
def test_changed_checkpoint_is_refused(tree):
    tree["ckpt"].write_bytes(b"other weights")
    with pytest.raises(PermissionError, match="checkpoint_sha256"):
        check(tree)


# 21. detector cache
@pytest.mark.parametrize("name,key", [("detections-dev.jsonl", "dev_detections_sha256"), ("detections-test.jsonl", "test_detections_sha256")])
def test_changed_detector_cache_is_refused(tree, name, key):
    (tree["runs"] / name).write_text("tampered\n")
    with pytest.raises(PermissionError, match=key):
        check(tree)


# 22. feature cache
@pytest.mark.parametrize("name,key", [("features-dev.jsonl", "dev_features_sha256"), ("features-test.jsonl", "test_features_sha256")])
def test_changed_feature_cache_is_refused(tree, name, key):
    (tree["runs"] / name).write_text("tampered\n")
    with pytest.raises(PermissionError, match=key):
        check(tree)


@pytest.mark.parametrize("name,key", [("manifest.jsonl", "dataset_manifest_sha256"), ("labels.sha256", "dataset_labels_sha256"), ("checksums.sha256", "dataset_images_sha256")])
def test_changed_dataset_is_refused(tree, name, key):
    (tree["data"] / name).write_text("tampered\n")
    with pytest.raises(PermissionError, match=key):
        check(tree)


def test_test_seal_under_another_policy_is_refused(tree):
    payload = json.loads(tree["seal"].read_text())
    payload["frozen_policy_sha256"] = "0" * 64
    tree["seal"].write_text(json.dumps(payload))
    with pytest.raises(PermissionError, match="different policy"):
        check(tree)


# 17. reference designation never reads a TEST capture
def test_reference_designation_rejects_non_reference_records(tmp_path):
    import references

    (tmp_path / "manifest.jsonl").write_text(json.dumps({"split": "test", "subset": "temporal", "sample_id": "x"}) + "\n")
    with pytest.raises(SystemExit, match="no reference split"):
        references.designate(tmp_path)


def test_committed_frozen_policy_binds_everything_if_present():
    if not seal.FROZEN.exists():
        pytest.skip("policy not frozen yet")
    payload = json.loads(seal.FROZEN.read_text())
    assert set(payload["bindings"]) == {
        "code_sha256", "dataset_manifest_sha256", "dataset_labels_sha256", "dataset_images_sha256", "dataset_config_sha256", "checkpoint_sha256",
        "reference_metadata_sha256", "reference_aggregate_sha256", "dev_detections_sha256", "dev_features_sha256",
    }
    assert payload["policy_sha256"] == seal.sha256_json(payload["policy"]) and payload["code_revision_git_commit"]
