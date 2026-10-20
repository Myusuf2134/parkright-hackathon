from types import SimpleNamespace

from a2_finetune.metrics import box_iou, detector_metrics, parking_metrics


def test_bbox_iou_and_detection_metrics():
    assert box_iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1
    predictions = {"a": {"boxes": [[0, 0, 10, 10]], "labels": [1], "scores": [0.9]}}
    truths = {"a": {"boxes": [[0, 0, 10, 10]], "labels": [1]}}
    result = detector_metrics(predictions, truths, 0.65)
    assert result["vehicle_binary"]["precision"] == 1
    assert result["vehicle_binary"]["recall"] == 1
    assert result["vehicle_binary"]["map_50_95"] == 1


def test_parking_policy_never_emits_open_and_reports_diagnostic():
    record = SimpleNamespace(sample_id="a")
    label = {"spaces": [{"space_id": "A1", "truth": "occupied", "polygon_px": [[0, 0], [10, 0], [10, 10], [0, 10]]}]}
    weak = {"boxes": [[0, 0, 10, 10]], "labels": [1], "scores": [0.04]}
    result = parking_metrics([(record, label, weak)], confidence=0.65, occupied_coverage=0.45, ambiguity_confidence=0.05, ambiguity_coverage=0.02)
    assert result["production_false_open_count"] == 0
    assert result["uncertain_rate"] == 1
    assert result["hypothetical_false_open"] == 1

