from datetime import UTC, datetime, timedelta

from parkright_api.stream_tracker import FrameStreamTracker
from parkright_contracts import FrameMetadata

NOW = datetime(2026, 10, 14, 12, tzinfo=UTC)


def frame(seq: int, **over) -> FrameMetadata:
    return FrameMetadata(**({"session_id": "run-1", "camera_id": "cam-01", "seq": seq, "sim_time_ms": seq * 100, "captured_at": NOW - timedelta(milliseconds=50)} | over))


def feed(t: FrameStreamTracker, m: FrameMetadata):
    v = t.classify(m, NOW)
    if v.outcome in ("accepted", "stale"):
        t.commit(m)
    return v


def test_accepts_first_and_increasing():
    t = FrameStreamTracker(10_000)
    assert feed(t, frame(5)).outcome == "accepted"
    assert feed(t, frame(6)).gap == 0


def test_duplicate():
    t = FrameStreamTracker(10_000)
    feed(t, frame(1))
    assert feed(t, frame(1)).outcome == "duplicate"


def test_out_of_order_does_not_move_stream_back():
    t = FrameStreamTracker(10_000)
    feed(t, frame(1))
    feed(t, frame(3))
    assert feed(t, frame(2)).outcome == "out_of_order"
    assert feed(t, frame(3)).outcome == "duplicate"


def test_gaps_are_allowed_and_reported():
    t = FrameStreamTracker(10_000)
    feed(t, frame(1))
    v = feed(t, frame(5))
    assert (v.outcome, v.gap) == ("accepted", 3)


def test_stale_frames_advance_the_stream_without_being_accepted():
    t = FrameStreamTracker(10_000)
    feed(t, frame(1))
    assert feed(t, frame(2, captured_at=NOW - timedelta(seconds=60))).outcome == "stale"
    assert feed(t, frame(2)).outcome == "duplicate"


def test_sim_time_regression_is_rejected():
    t = FrameStreamTracker(10_000)
    feed(t, frame(10))
    assert feed(t, frame(11, sim_time_ms=5)).outcome == "rejected"


def test_session_restart_and_superseded_session():
    t = FrameStreamTracker(10_000)
    feed(t, frame(100))
    assert feed(t, frame(0, session_id="run-2")).outcome == "accepted"
    assert feed(t, frame(101)).outcome == "superseded_session"
    assert feed(t, frame(1, session_id="run-2")).outcome == "accepted"


def test_cameras_are_independent():
    t = FrameStreamTracker(10_000)
    feed(t, frame(5))
    assert feed(t, frame(1, camera_id="cam-02")).outcome == "accepted"
