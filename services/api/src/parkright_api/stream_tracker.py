"""Ordering for camera frame streams. In memory: one API process is the hackathon
deployment, and losing this on restart only means the next frame from each camera
is taken as the start of its stream.

A stream is (camera_id, session_id). Within it, ``seq`` must strictly increase and
``sim_time_ms`` must not go backwards. Wall-clock ``captured_at`` is used only to
decide whether a frame is too old to describe the present.

    same seq as the last processed one ........ duplicate          (no-op, safe to retry)
    lower seq than the last processed one ..... out_of_order       (dropped)
    higher seq, sim_time_ms went backwards .... rejected           (producer bug → HTTP 409)
    higher seq, captured too long ago ......... stale              (seq recorded, state untouched)
    a session_id not seen before .............. new stream; supersedes the camera's previous session
    a session_id the camera has moved on from . superseded_session (dropped)
    higher seq ................................ accepted (gaps allowed, reported)
"""

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from parkright_contracts import FrameMetadata, FrameOutcome

MAX_RETIRED_SESSIONS = 32


@dataclass(frozen=True, slots=True)
class Verdict:
    outcome: FrameOutcome | Literal["rejected"]
    gap: int = 0
    detail: str | None = None


@dataclass(slots=True)
class _Camera:
    session: str
    seq: int | None = None
    sim_time_ms: int | None = None
    retired: deque[str] = field(default_factory=lambda: deque(maxlen=MAX_RETIRED_SESSIONS))


class FrameStreamTracker:
    def __init__(self, max_age_ms: int) -> None:
        self._max_age_ms = max_age_ms
        self._cameras: dict[str, _Camera] = {}

    def classify(self, m: FrameMetadata, now: datetime) -> Verdict:
        cam = self._cameras.get(m.camera_id)
        if cam and m.session_id in cam.retired:
            return Verdict(FrameOutcome.SUPERSEDED_SESSION, detail=f"camera {m.camera_id} has moved on to session {cam.session}")
        same = cam is not None and cam.session == m.session_id and cam.seq is not None
        if same:
            assert cam is not None and cam.seq is not None and cam.sim_time_ms is not None
            if m.seq == cam.seq:
                return Verdict(FrameOutcome.DUPLICATE)
            if m.seq < cam.seq:
                return Verdict(FrameOutcome.OUT_OF_ORDER, detail=f"seq {m.seq} arrived after {cam.seq}")
            if m.sim_time_ms < cam.sim_time_ms:
                return Verdict("rejected", detail=f"sim_time_ms went backwards ({m.sim_time_ms} < {cam.sim_time_ms}) while seq advanced")
        gap = m.seq - cam.seq - 1 if same and cam and cam.seq is not None else 0
        age_ms = (now - m.captured_at).total_seconds() * 1000
        if age_ms > self._max_age_ms:
            return Verdict(FrameOutcome.STALE, gap=gap, detail=f"captured {age_ms:.0f} ms ago (limit {self._max_age_ms} ms)")
        detail = None if same else (f"new session (was {cam.session})" if cam else "first frame from this camera")
        return Verdict(FrameOutcome.ACCEPTED, gap=gap, detail=detail)

    def commit(self, m: FrameMetadata) -> None:
        """Records that a frame was processed (accepted or stale), advancing its stream."""
        cam = self._cameras.get(m.camera_id)
        if cam is None:
            cam = self._cameras[m.camera_id] = _Camera(session=m.session_id)
        elif cam.session != m.session_id:
            cam.retired.append(cam.session)
            cam.session = m.session_id
        cam.seq, cam.sim_time_ms = m.seq, m.sim_time_ms
