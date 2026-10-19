from __future__ import annotations

from collections import defaultdict
from typing import Iterable

import numpy as np
from shapely.geometry import Polygon, box as shapely_box


def box_iou(a: Iterable[float], b: Iterable[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    intersection = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection
    return intersection / union if union > 0 else 0.0


def _matches(predictions, truths, iou_threshold: float, confidence: float, binary: bool):
    events = []
    truth_count = 0
    truth_by_image = {}
    for image_id, truth in truths.items():
        labels = [1] * len(truth["labels"]) if binary else truth["labels"]
        truth_by_image[image_id] = {"boxes": truth["boxes"], "labels": labels, "used": [False] * len(labels)}
        truth_count += len(labels)
    candidates = []
    for image_id, prediction in predictions.items():
        for box, label, score in zip(prediction["boxes"], prediction["labels"], prediction["scores"], strict=True):
            if score >= confidence:
                candidates.append((float(score), image_id, box, 1 if binary else label))
    for score, image_id, box, label in sorted(candidates, reverse=True):
        target = truth_by_image[image_id]
        choices = [(box_iou(box, gt), idx) for idx, (gt, gt_label) in enumerate(zip(target["boxes"], target["labels"], strict=True)) if not target["used"][idx] and gt_label == label]
        overlap, match = max(choices, default=(0.0, -1))
        true_positive = overlap >= iou_threshold
        if true_positive:
            target["used"][match] = True
        events.append((score, true_positive))
    return events, truth_count


def precision_recall(predictions, truths, *, confidence: float, iou: float = 0.5, binary: bool = False):
    events, truth_count = _matches(predictions, truths, iou, confidence, binary)
    tp = sum(match for _, match in events)
    fp = len(events) - tp
    fn = truth_count - tp
    return {
        "true_positive": tp,
        "false_positive": fp,
        "false_negative": fn,
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / truth_count if truth_count else 0.0,
    }


def average_precision(predictions, truths, *, iou: float, label: int | None = None, binary: bool = False) -> float:
    selected_predictions, selected_truths = {}, {}
    for image_id, truth in truths.items():
        mask = [True] * len(truth["labels"]) if label is None else [value == label for value in truth["labels"]]
        selected_truths[image_id] = {key: [value for value, keep in zip(truth[key], mask, strict=True) if keep] for key in ("boxes", "labels")}
    for image_id, prediction in predictions.items():
        mask = [True] * len(prediction["labels"]) if label is None else [value == label for value in prediction["labels"]]
        selected_predictions[image_id] = {key: [value for value, keep in zip(prediction[key], mask, strict=True) if keep] for key in ("boxes", "labels", "scores")}
    events, total = _matches(selected_predictions, selected_truths, iou, 0.0, binary)
    if total == 0:
        return float("nan")
    tp = np.cumsum([match for _, match in events], dtype=float)
    fp = np.cumsum([not match for _, match in events], dtype=float)
    recall = tp / total
    precision = tp / np.maximum(tp + fp, 1)
    return float(np.mean([max(precision[recall >= point], default=0.0) for point in np.linspace(0, 1, 101)]))


def detector_metrics(predictions, truths, confidence: float) -> dict:
    thresholds = [0.5 + 0.05 * index for index in range(10)]
    per_class = {}
    for label, name in ((1, "car"), (2, "truck")):
        aps = [average_precision(predictions, truths, iou=value, label=label) for value in thresholds]
        per_class[name] = {
            "ap50": None if np.isnan(aps[0]) else aps[0],
            "map_50_95": None if all(np.isnan(value) for value in aps) else float(np.nanmean(aps)),
        }
    binary_aps = [average_precision(predictions, truths, iou=value, binary=True) for value in thresholds]
    return {
        "confidence_gate": confidence,
        "iou_gate": 0.5,
        "mapped": precision_recall(predictions, truths, confidence=confidence),
        "vehicle_binary": {
            **precision_recall(predictions, truths, confidence=confidence, binary=True),
            "ap50": binary_aps[0],
            "map_50_95": float(np.nanmean(binary_aps)),
        },
        "per_class": per_class,
    }


def parking_metrics(samples, *, confidence: float, occupied_coverage: float, ambiguity_confidence: float, ambiguity_coverage: float):
    counts = defaultdict(int)
    rows = []
    for record, label, prediction in samples:
        for space in label["spaces"]:
            polygon = Polygon(space["polygon_px"])
            occupied = False
            ambiguous = False
            for box, score in zip(prediction["boxes"], prediction["scores"], strict=True):
                overlap = polygon.intersection(shapely_box(*box)).area / polygon.area
                occupied |= score >= confidence and overlap >= occupied_coverage
                ambiguous |= score >= ambiguity_confidence and overlap >= ambiguity_coverage
            state = "OCCUPIED" if occupied else "UNCERTAIN"
            truth = space["truth"]
            counts["spaces"] += 1
            counts[f"truth_{truth}"] += 1
            counts[f"predicted_{state.lower()}"] += 1
            counts["occupied_tp"] += int(occupied and truth == "occupied")
            counts["occupied_fp"] += int(occupied and truth == "empty")
            counts["occupied_fn"] += int(not occupied and truth == "occupied")
            counts["policy_correct"] += int((truth == "occupied" and state == "OCCUPIED") or (truth == "empty" and state == "UNCERTAIN"))
            # Diagnostic only: a naive absence-as-OPEN rule, never production behavior.
            hypothetical_open = not ambiguous
            counts["hypothetical_open"] += int(hypothetical_open)
            counts["hypothetical_false_open"] += int(hypothetical_open and truth == "occupied")
            rows.append({"sample_id": record.sample_id, "space_id": space["space_id"], "truth": truth, "state": state})
    tp, fp, fn = counts["occupied_tp"], counts["occupied_fp"], counts["occupied_fn"]
    total = counts["spaces"]
    return {
        **dict(counts),
        "occupied_precision": tp / (tp + fp) if tp + fp else 0.0,
        "occupied_recall": tp / (tp + fn) if tp + fn else 0.0,
        "space_policy_accuracy": counts["policy_correct"] / total if total else 0.0,
        "uncertain_rate": counts["predicted_uncertain"] / total if total else 0.0,
        "production_false_open_count": 0,
        "production_false_open_rate": 0.0,
        "hypothetical_false_open_rate_on_occupied": counts["hypothetical_false_open"] / counts["truth_occupied"] if counts["truth_occupied"] else 0.0,
        "rows": rows,
    }
