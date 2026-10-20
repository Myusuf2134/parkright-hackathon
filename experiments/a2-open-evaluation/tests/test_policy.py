from policy import attach_single_frame_states, attach_temporal_state, classify, metrics


def row(**changes):
    value = {
        "sample_id": "sample-1",
        "scenario_id": "scenario-1",
        "space_id": "A1",
        "truth": "empty",
        "environment": "clear_day",
        "density": "sparse",
        "kind": "settled",
        "family": "settled",
        "row": "far",
        "vehicle_class": "empty",
        "robustness_variant": "none",
        "transition_type": "none",
        "frame_valid": True,
        "roi_valid": True,
        "detector_complete": True,
        "occupied_evidence": False,
        "ambiguous_evidence": False,
        "any_overlap_evidence": False,
        "frame_has_detection": False,
        "has_scenario_occluder": False,
        "overlaps": [],
    }
    value.update(changes)
    return value


def test_current_policy_never_opens_on_absence():
    assert classify(row(), "current") == "UNCERTAIN"


def test_occupied_evidence_wins_for_every_policy():
    occupied = row(occupied_evidence=True, ambiguous_evidence=True)
    for policy in (
        "current",
        "naive_absence",
        "low_floor_space_veto",
        "any_overlap_veto",
        "whole_frame_clear",
        "oracle_context_gate",
    ):
        assert classify(occupied, policy) == "OCCUPIED"


def test_invalid_or_incomplete_evidence_cannot_open():
    for change in (
        {"frame_valid": False},
        {"roi_valid": False},
        {"detector_complete": False},
    ):
        assert classify(row(**change), "naive_absence") == "UNCERTAIN"


def test_stricter_vetoes_abstain_on_evidence():
    assert classify(row(ambiguous_evidence=True), "low_floor_space_veto") == "UNCERTAIN"
    assert classify(row(any_overlap_evidence=True), "any_overlap_veto") == "UNCERTAIN"
    assert classify(row(frame_has_detection=True), "whole_frame_clear") == "UNCERTAIN"


def test_oracle_context_gate_is_blocked_by_transition_or_occluder():
    assert classify(row(kind="transition"), "oracle_context_gate") == "UNCERTAIN"
    assert classify(row(has_scenario_occluder=True), "oracle_context_gate") == "UNCERTAIN"


def test_temporal_policy_requires_adjacent_frames_and_resets():
    rows = [row(sample_id=f"s-{i}", sequence_id="stream", sequence_index=i) for i in range(5)]
    attach_single_frame_states(rows)
    rows[2]["states"]["low_floor_space_veto"] = "UNCERTAIN"
    attach_temporal_state(rows, window=2)
    assert [item["states"]["temporal_2"] for item in rows] == [
        "UNCERTAIN", "OPEN", "UNCERTAIN", "UNCERTAIN", "OPEN"
    ]


def test_temporal_policy_never_uses_unsequenced_snapshots():
    rows = [row(sample_id="a"), row(sample_id="b")]
    attach_single_frame_states(rows)
    attach_temporal_state(rows, window=2)
    assert all(item["states"]["temporal_2"] == "UNCERTAIN" for item in rows)


def test_false_open_metric_is_strict_and_uncertain_is_abstention():
    rows = [row(truth="occupied"), row(sample_id="sample-2", truth="empty")]
    attach_single_frame_states(rows)
    got = metrics(rows, "naive_absence")
    assert got["false_open"] == 1
    assert got["false_open_rate_on_occupied"] == 1.0
    assert got["open_precision"] == 0.5
    assert got["policy_accuracy"] == 0.5
