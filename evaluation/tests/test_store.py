from parkright_contracts import GroundTruthRecord
from parkright_evaluation import GroundTruthStore


def record(seq: int, session: str = "s1") -> GroundTruthRecord:
    return GroundTruthRecord(
        session_id=session, camera_id="cam-01", seq=seq, sim_time_ms=seq * 100, environment_preset=None,
        spaces=[{"space_id": "A1", "truth": "occupied"}],
    )


def test_keeps_streams_apart_and_bounded():
    store = GroundTruthStore(max_per_stream=3)
    for i in range(5):
        store.add(record(i))
    store.add(record(0, session="s2"))
    assert [r.seq for r in store.list("cam-01", "s1")] == [2, 3, 4]
    assert [r.seq for r in store.list("cam-01", "s2")] == [0]
    assert store.get("cam-01", "s1", 3).seq == 3
    assert store.get("cam-01", "s1", 0) is None
