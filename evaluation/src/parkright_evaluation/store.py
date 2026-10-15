from collections import deque
from threading import Lock

from parkright_contracts import GroundTruthRecord


class GroundTruthStore:
    """Simulator ground truth, in memory, per (camera_id, session_id).

    Kept apart from parking state. Only the evaluation route holds a reference
    to it; the frame path and perception never import this package.
    """

    def __init__(self, max_per_stream: int = 10_000) -> None:
        self._max = max_per_stream
        self._streams: dict[tuple[str, str], deque[GroundTruthRecord]] = {}
        self._lock = Lock()

    def add(self, record: GroundTruthRecord) -> None:
        with self._lock:
            key = (record.camera_id, record.session_id)
            self._streams.setdefault(key, deque(maxlen=self._max)).append(record)

    def list(self, camera_id: str, session_id: str, limit: int = 100) -> list[GroundTruthRecord]:
        with self._lock:
            records = list(self._streams.get((camera_id, session_id), ()))
        return records[-limit:]

    def get(self, camera_id: str, session_id: str, seq: int) -> GroundTruthRecord | None:
        with self._lock:
            for record in reversed(self._streams.get((camera_id, session_id), ())):
                if record.seq == seq:
                    return record
        return None
