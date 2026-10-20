"""Temporal confirmation and transition gating over distinct frames of one camera session.

Only *distinct, in-order, fresh, continuous* frames count:

- a frame whose JPEG SHA-256 already occurs in the window is a duplicate: it adds no
  observation and is never itself open-ready;
- a sequence number not greater than the last accepted one is out of order: rejected;
- a stale frame (too old on arrival) is rejected;
- a new session, or a time gap larger than max_gap_ms, restarts the window.

Transition state per space (no ground truth): ``unknown`` until two distinct frames exist;
``suspected`` when the bay interior's appearance changed between consecutive frames, or a
detection within motion_radius_px of the bay moved (no match with IoU ≥ motion_iou in the previous frame), or a
detection partially covers the bay; ``settled`` otherwise. Any suspicion inside the window
blocks readiness.

open_ready requires: the last `window` distinct frames all valid and all passing every
single-frame gate, settled transition state throughout, and no OCCUPIED evidence now.
It is advisory evaluation output and never changes occupancy.
"""

from collections import deque
from dataclasses import asdict, dataclass, field
from datetime import datetime

from .frame import EvidenceConfig, FrameContext, SpaceFrameEvidence


@dataclass(frozen=True)
class SpaceOpenEvidence:
    space_id: str
    frame_valid: bool
    visibility_score: float
    occlusion_risk: float
    vehicle_overlap: float
    marking_visibility: float
    interior_clutter: float
    distinct_frame_count: int
    temporal_consistency: float
    transition_state: str
    open_ready: bool
    blocking_reasons: tuple[str, ...]
    advisory_only: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Record:
    seq: int
    captured_at: datetime
    image_sha256: str
    spaces: dict[str, SpaceFrameEvidence]
    suspected: dict[str, bool] = field(default_factory=dict)


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _changed(now: SpaceFrameEvidence, before: SpaceFrameEvidence, c: EvidenceConfig) -> bool:
    pairs = [(a, b) for a, b in zip(now.signature, before.signature, strict=False) if a >= 0 and b >= 0]
    if not pairs or len(now.signature) != len(before.signature):
        return True
    scale = sum(b for _, b in pairs) / len(pairs) + 10.0
    if sum(abs(a - b) for a, b in pairs) / len(pairs) / scale > c.max_appearance_change:
        return True
    near = [b for b in now.near_boxes if b[4] <= c.motion_radius_px]
    return any(max((_iou(box, old) for old in before.near_boxes), default=0.0) < c.motion_iou for box in near)


class TemporalTracker:
    """One tracker per camera. Feed frames in arrival order; read SpaceOpenEvidence back."""

    def __init__(self, config: EvidenceConfig = EvidenceConfig()):
        self.config = config
        self.session: str | None = None
        self.last_seq: int | None = None
        self.window: deque[_Record] = deque(maxlen=max(2, config.window))

    def _reset(self, session: str | None):
        self.session, self.last_seq = session, None
        self.window.clear()

    def observe(self, ctx: FrameContext, spaces: dict[str, SpaceFrameEvidence], now: datetime) -> dict[str, SpaceOpenEvidence]:
        c = self.config
        frame_block: list[str] = []
        if ctx.session_id != self.session:
            self._reset(ctx.session_id)
        age_ms = (now - ctx.captured_at).total_seconds() * 1000
        if self.last_seq is not None and ctx.seq <= self.last_seq:
            frame_block.append("out_of_order_frame")
        elif not (-2000 <= age_ms <= c.max_frame_age_ms):
            frame_block.append("stale_frame")
        elif any(r.image_sha256 == ctx.image_sha256 for r in self.window):
            frame_block.append("duplicate_frame")
            self.last_seq = ctx.seq
        else:
            if self.window and (ctx.captured_at - self.window[-1].captured_at).total_seconds() * 1000 > c.max_gap_ms:
                self.window.clear()
            record = _Record(ctx.seq, ctx.captured_at, ctx.image_sha256, spaces)
            previous = self.window[-1] if self.window else None
            for sid, ev in spaces.items():
                partial = 0 < ev.vehicle_overlap and not ev.occupied
                moved = previous is not None and sid in previous.spaces and _changed(ev, previous.spaces[sid], c)
                record.suspected[sid] = partial or moved
            self.window.append(record)
            self.last_seq = ctx.seq
        return {sid: self._space(sid, spaces[sid], frame_block) for sid in spaces}

    def _space(self, sid: str, current: SpaceFrameEvidence, frame_block: list[str]) -> SpaceOpenEvidence:
        c = self.config
        recent = list(self.window)[-c.window:]
        passing = [r for r in recent if sid in r.spaces and not r.spaces[sid].blocking(c)]
        consistency = len(passing) / c.window
        if len(self.window) < 2:
            transition = "unknown"
        elif any(r.suspected.get(sid, True) for r in recent):
            transition = "suspected"
        else:
            transition = "settled"
        reasons = list(frame_block) + current.blocking(c)
        if len(self.window) < c.window:
            reasons.append("insufficient_distinct_frames")
        elif len(passing) < c.window:
            reasons.append("temporal_inconsistent")
        if transition != "settled":
            reasons.append(f"transition_{transition}")
        reasons = list(dict.fromkeys(reasons))
        return SpaceOpenEvidence(
            space_id=sid,
            frame_valid=current.frame_valid and not frame_block,
            visibility_score=current.visibility_score,
            occlusion_risk=current.occlusion_risk,
            vehicle_overlap=current.vehicle_overlap,
            marking_visibility=current.marking_visibility,
            interior_clutter=current.interior_clutter,
            distinct_frame_count=len(self.window),
            temporal_consistency=round(consistency, 4),
            transition_state=transition,
            open_ready=not reasons,
            blocking_reasons=tuple(reasons),
        )
