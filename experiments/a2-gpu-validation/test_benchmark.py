import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location("gpu_benchmark", Path(__file__).with_name("benchmark.py"))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def test_stats():
    assert b.stats(range(1, 101)) == {"count": 100, "mean": 50.5, "median": 50.5, "p95": 95, "p99": 99}
    assert b.stats([]) == {"count": 0}


def test_subset_is_order_independent_and_covers_strata():
    records = [SimpleNamespace(environment=e, subset="test", family="standard", kind=k, sample_id=f"{e}-{k}-{i}")
               for e in ("day", "night") for k in ("settled", "transition") for i in range(4)]
    assert [r.sample_id for r in b.subset(records)] == [r.sample_id for r in b.subset(list(reversed(records)))]
    assert len(b.subset(records)) == 8


def pred(score=.9, label=1):
    return {"frame": {"boxes": [[0, 0, 20, 20]], "labels": [label], "scores": [score]}}


def test_comparison_identity_and_gate_crossing():
    assert b.compare(pred(), pred())["max_score_delta"] == 0
    assert b.compare(pred(.6499), pred(.6501))["confidence_gate_crossings"] == 1
    assert b.compare(pred(), pred(label=2))["unmatched_detections_at_iou_099"] == 2


def test_rejects_artifact_change(tmp_path):
    path = tmp_path / "changed"
    path.write_text("not a checkpoint")
    with pytest.raises(ValueError, match="checksum"):
        b.verify(path, path, path, None)


def test_configuration_frozen():
    config = b.load_config(Path(__file__).resolve().parents[1] / "a2-finetune/config.json")
    assert config.sha256() == b.CONFIG
    assert config.evaluation_confidence == .65
    assert config.occupied_coverage == .45
    assert config.allow_open is False


def test_sustained_accounting():
    result = b.sustained(lambda _: None, [object()], 20, .2)
    assert result["attempted"] == 4
    assert result["accepted"] == result["completed"]
    assert result["accepted"] + result["dropped"] + result["scheduler_skipped"] == 4


def test_sustained_overload_is_bounded():
    result = b.sustained(lambda _: b.time.sleep(.08), [object()], 100, .2)
    assert result["dropped"] > 0
    assert result["sustainable"] is False
    assert result["accepted"] == result["completed"]
    assert result["accepted"] + result["dropped"] + result["scheduler_skipped"] == 20
