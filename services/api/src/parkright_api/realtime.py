"""In-process realtime fan-out. One API process is the hackathon deployment; the interface
is small enough to back with Redis or Postgres NOTIFY later."""

import asyncio
from collections import defaultdict


class RealtimeHub:
    def __init__(self, queue_size: int = 64) -> None:
        self._queue_size = queue_size
        self._subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)

    def subscribe(self, facility_id: str) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers[facility_id].add(queue)
        return queue

    def unsubscribe(self, facility_id: str, queue: asyncio.Queue[str]) -> None:
        subs = self._subscribers.get(facility_id)
        if subs is not None:
            subs.discard(queue)
            if not subs:
                del self._subscribers[facility_id]

    def publish(self, facility_id: str, payload: str) -> int:
        """Every message carries the full facility state, so a slow client that misses one
        loses nothing: its oldest queued message is dropped to make room."""
        subs = self._subscribers.get(facility_id, set())
        for queue in subs:
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(payload)
        return len(subs)

    def subscriber_count(self) -> int:
        return sum(len(s) for s in self._subscribers.values())
