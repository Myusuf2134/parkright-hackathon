"""Pure, production-independent policy scoring for the A2 OPEN safety evaluation."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable


OCCUPIED_CONFIDENCE = 0.65
OCCUPIED_COVERAGE = 0.45
AMBIGUITY_CONFIDENCE = 0.05
AMBIGUITY_COVERAGE = 0.02

SINGLE_FRAME_POLICIES = (
    "current",
    "naive_absence",
    "low_floor_space_veto",
    "any_overlap_veto",
    "whole_frame_clear",
    "oracle_context_gate",
)


def classify(row: dict, policy: str) -> str:
    """Classify one space without changing the production provider."""
    if row["occupied_evidence"]:
        return "OCCUPIED"
    if policy == "current":
        return "UNCERTAIN"
    if not row["frame_valid"] or not row["roi_valid"] or not row["detector_complete"]:
        return "UNCERTAIN"
    if policy == "naive_absence":
        return "OPEN"
    if policy == "low_floor_space_veto":
        return "UNCERTAIN" if row["ambiguous_evidence"] else "OPEN"
    if policy == "any_overlap_veto":
        return "UNCERTAIN" if row["any_overlap_evidence"] else "OPEN"
    if policy == "whole_frame_clear":
        return "UNCERTAIN" if row["frame_has_detection"] else "OPEN"
    if policy == "oracle_context_gate":
        # Diagnostic upper bound only. These fields come from TEST labels/scenario
        # metadata and are not available to the production A2 provider.
        blocked = row["kind"] != "settled" or row["has_scenario_occluder"]
        return "UNCERTAIN" if blocked or row["ambiguous_evidence"] else "OPEN"
    raise ValueError(f"unknown policy: {policy}")


def attach_single_frame_states(rows: list[dict]) -> None:
    for row in rows:
        row["states"] = {policy: classify(row, policy) for policy in SINGLE_FRAME_POLICIES}


def attach_temporal_state(
    rows: list[dict],
    *,
    window: int,
    base_policy: str = "low_floor_space_veto",
    output_policy: str | None = None,
) -> str:
    """Require N adjacent observations in a declared real sequence.

    Rows without a sequence, gaps in integer sequence_index, or any intervening
    non-candidate observation abstain. OCCUPIED evidence still wins immediately.
    """
    if window < 2:
        raise ValueError("temporal window must be at least 2")
    name = output_policy or f"temporal_{window}"
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        sequence_id = row.get("sequence_id")
        if sequence_id is not None:
            grouped[(sequence_id, row["space_id"])].append(row)

    histories: dict[int, bool] = {}
    for group in grouped.values():
        ordered = sorted(group, key=lambda item: item["sequence_index"])
        candidate_run: list[dict] = []
        previous_index = None
        for row in ordered:
            index = row["sequence_index"]
            if previous_index is None or index != previous_index + 1:
                candidate_run = []
            if row["states"][base_policy] == "OPEN":
                candidate_run.append(row)
            else:
                candidate_run = []
            histories[id(row)] = len(candidate_run) >= window
            previous_index = index

    for row in rows:
        if row["occupied_evidence"]:
            state = "OCCUPIED"
        elif histories.get(id(row), False):
            state = "OPEN"
        else:
            state = "UNCERTAIN"
        row["states"][name] = state
    return name


def metrics(rows: Iterable[dict], policy: str) -> dict:
    selected = list(rows)
    counts = {
        "space_observations": len(selected),
        "truth_occupied": 0,
        "truth_empty": 0,
        "predicted_occupied": 0,
        "predicted_open": 0,
        "predicted_uncertain": 0,
        "open_true_positive": 0,
        "false_open": 0,
        "occupied_true_positive": 0,
        "occupied_false_positive": 0,
        "occupied_false_negative": 0,
        "correct_explicit_decisions": 0,
    }
    false_opens = []
    for row in selected:
        truth = row["truth"]
        state = row["states"][policy]
        counts[f"truth_{truth}"] += 1
        counts[f"predicted_{state.lower()}"] += 1
        if state == "OPEN" and truth == "empty":
            counts["open_true_positive"] += 1
            counts["correct_explicit_decisions"] += 1
        elif state == "OPEN" and truth == "occupied":
            counts["false_open"] += 1
            false_opens.append(false_open_detail(row, policy))
        elif state == "OCCUPIED" and truth == "occupied":
            counts["occupied_true_positive"] += 1
            counts["correct_explicit_decisions"] += 1
        elif state == "OCCUPIED" and truth == "empty":
            counts["occupied_false_positive"] += 1
        if truth == "occupied" and state != "OCCUPIED":
            counts["occupied_false_negative"] += 1

    open_predictions = counts["predicted_open"]
    occupied_predictions = counts["predicted_occupied"]
    total = counts["space_observations"]
    return {
        **counts,
        "open_precision": (
            counts["open_true_positive"] / open_predictions if open_predictions else None
        ),
        "open_recall": (
            counts["open_true_positive"] / counts["truth_empty"]
            if counts["truth_empty"]
            else None
        ),
        "false_open_rate_on_occupied": (
            counts["false_open"] / counts["truth_occupied"]
            if counts["truth_occupied"]
            else None
        ),
        "occupied_precision": (
            counts["occupied_true_positive"] / occupied_predictions
            if occupied_predictions
            else None
        ),
        "occupied_recall": (
            counts["occupied_true_positive"] / counts["truth_occupied"]
            if counts["truth_occupied"]
            else None
        ),
        "uncertain_percentage": (
            100.0 * counts["predicted_uncertain"] / total if total else None
        ),
        # UNCERTAIN is an abstention and therefore is not counted as correct.
        "policy_accuracy": (
            counts["correct_explicit_decisions"] / total if total else None
        ),
        "false_open_cases": false_opens,
    }


def false_open_detail(row: dict, policy: str) -> dict:
    overlaps = row.get("overlaps", [])
    if not overlaps:
        reason = "NO_A2_DETECTION_OVERLAPPED_SPACE"
    elif not any(item["score"] >= OCCUPIED_CONFIDENCE for item in overlaps):
        reason = "ALL_OVERLAPPING_DETECTIONS_BELOW_OCCUPIED_CONFIDENCE"
    else:
        reason = "OVERLAPPING_DETECTION_BELOW_OCCUPIED_COVERAGE"
    return {
        "policy": policy,
        "sample_id": row["sample_id"],
        "scenario_id": row.get("scenario_id"),
        "environment": row["environment"],
        "density": row["density"],
        "kind": row["kind"],
        "family": row["family"],
        "space_id": row["space_id"],
        "row": row["row"],
        "reason": reason,
        "overlaps": overlaps,
    }


def breakdowns(rows: list[dict], policies: Iterable[str]) -> dict:
    output = {}
    dimensions = (
        "environment",
        "density",
        "kind",
        "family",
        "row",
        "vehicle_class",
        "robustness_variant",
        "transition_type",
    )
    for dimension in dimensions:
        groups: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            groups[str(row[dimension])].append(row)
        output[dimension] = {
            value: {policy: metrics(group, policy) for policy in policies}
            for value, group in sorted(groups.items())
        }
    return output
