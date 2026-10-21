"""Temporal confirmation and transition gating over distinct frames of one camera session.

Only *distinct, in-order, fresh, continuous* frames count. Per session (a new session id
resets everything):

- seq must strictly increase: a lower or equal seq is ``out_of_order_frame`` (rejected; the
  window is kept, because newer frames were already counted);
- capture time must strictly increase: an earlier or equal timestamp with a higher seq means
  the clock or the stream is inconsistent: ``non_monotonic_timestamp`` (rejected, and the
  readiness window and tracks are reset);
- a stale frame (too old on arrival) is ``stale_frame`` (rejected);
- a JPEG seen before anywhere in this session is ``duplicate_frame`` (rejected: it adds no
  observation and is never itself open-ready). "Seen" is answered by :class:`SeenFrames`: an exact cache of recent hashes
  plus a fixed-size Bloom filter of every hash in the session, so a replay is caught even
  after it leaves the readiness window. Memory is bounded; a Bloom false positive only ever
  rejects a fresh frame (conservative);
- a gap larger than max_gap_ms restarts the window (and tracks).

Transition gating per space (no ground truth). Two modes:

``coarse`` (the v1 baseline): ``suspected`` when the bay interior's appearance changed between
consecutive frames, a detection partially covers the bay, or any detection within
motion_radius_px of the bay moved (no match with IoU ≥ motion_iou). The radius must not exceed
the radius the evidence was collected with (``near_radius_px``): that is refused, never capped.

``tracking``: bay-local appearance change and partial overlap as above, plus per-bay motion
from :mod:`.tracking`: approaching, departing, ambiguous (incl. a vehicle paused at the bay or
a young/ambiguous track next to it) and track lost near the bay. A lost track keeps blocking
the bays it was near for ``lost_cooldown_ms`` after it is deleted. Unrelated motion elsewhere
does not block.

``unknown`` until two distinct frames exist. Any non-settled state inside the window blocks.
open_ready requires the last ``window`` distinct frames all valid and all passing every
single-frame gate, settled transition throughout, and no OCCUPIED evidence now. It is advisory
evaluation output and never changes occupancy.
"""

import hashlib
from collections import OrderedDict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime

from shapely.geometry import Polygon

from .frame import EvidenceConfig, FrameContext, SpaceFrameEvidence, ViewGeometry
from .tracking import BayGeometry, TrackingConfig, VehicleTracker, bay_motion, bay_state


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
    # Tracking mode: this frame's bay motion state and the tracks behind it.
    bay_motion: str = "n/a"
    track_ids: tuple[int, ...] = ()

    def to_dict(self) -> dict:
        return asdict(self)


class SeenFrames:
    """Bounded per-session memory of JPEG hashes: exact recent cache + Bloom filter of all."""

    def __init__(self, recent: int = 4096, bits: int = 1 << 21, hashes: int = 7):
        self.recent_capacity, self.bits, self.hashes = recent, bits, hashes
        self.reset()

    def reset(self):
        self.recent: OrderedDict[str, None] = OrderedDict()
        self.bloom = bytearray(self.bits // 8)
        self.count = 0

    def _indices(self, sha: str):
        d = hashlib.sha256(sha.encode()).digest()
        return [int.from_bytes(d[4 * i:4 * i + 4], "big") % self.bits for i in range(self.hashes)]

    def __contains__(self, sha: str) -> bool:
        return sha in self.recent or all(self.bloom[i >> 3] >> (i & 7) & 1 for i in self._indices(sha))

    def add(self, sha: str):
        self.recent[sha] = None
        if len(self.recent) > self.recent_capacity:
            self.recent.popitem(last=False)
        for i in self._indices(sha):
            self.bloom[i >> 3] |= 1 << (i & 7)
        self.count += 1

    @property
    def memory_bytes(self) -> int:
        return len(self.bloom) + 64 * len(self.recent)


@dataclass
class _Record:
    seq: int
    captured_at: datetime
    image_sha256: str
    spaces: dict[str, SpaceFrameEvidence]
    state: dict[str, str] = field(default_factory=dict)  # per space: settled | suspected | approaching | ...
    motion: dict[str, str] = field(default_factory=dict)
    tracks: dict[str, tuple[int, ...]] = field(default_factory=dict)


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _appearance_changed(now: SpaceFrameEvidence, before: SpaceFrameEvidence, c: EvidenceConfig) -> bool:
    pairs = [(a, b) for a, b in zip(now.signature, before.signature, strict=False) if a >= 0 and b >= 0]
    if not pairs or len(now.signature) != len(before.signature):
        return True
    scale = sum(b for _, b in pairs) / len(pairs) + 10.0
    return sum(abs(a - b) for a, b in pairs) / len(pairs) / scale > c.max_appearance_change


def _near_motion(now: SpaceFrameEvidence, before: SpaceFrameEvidence, c: EvidenceConfig) -> bool:
    near = [b for b in now.near_boxes if b[4] <= c.motion_radius_px]
    return any(max((_iou(box, old) for old in before.near_boxes), default=0.0) < c.motion_iou for box in near)


def check_radius(spaces: dict[str, SpaceFrameEvidence], c: EvidenceConfig) -> None:
    """The coarse gate's radius must be covered by the radius evidence was collected with."""
    for sid, ev in spaces.items():
        if ev.near_radius_px < c.motion_radius_px:
            raise ValueError(f"{sid}: evidence collected within {ev.near_radius_px} px cannot support motion_radius_px {c.motion_radius_px}")


class TemporalTracker:
    """One tracker per camera. Feed frames in arrival order; read SpaceOpenEvidence back.

    tracking=None → coarse radius gate (baseline). With a TrackingConfig, ``view`` is required
    and ``observe`` needs the frame's detections.
    """

    def __init__(self, config: EvidenceConfig = EvidenceConfig(), tracking: TrackingConfig | None = None, view: ViewGeometry | None = None):
        if tracking is not None and view is None:
            raise ValueError("tracking mode needs the calibrated view")
        self.config, self.tracking, self.view = config, tracking, view
        self.session: str | None = None
        self.last_seq: int | None = None
        self.last_captured: datetime | None = None
        self.window: deque[_Record] = deque(maxlen=max(2, config.window))
        self.seen = SeenFrames()
        self.vehicles = VehicleTracker(tracking) if tracking else None
        self.cooldown: dict[str, float] = {}  # space → epoch seconds until which a lost track blocks it
        self._bays: list[BayGeometry] | None = None

    def _reset(self, session: str | None):
        self.session, self.last_seq, self.last_captured = session, None, None
        self.seen.reset()
        self._reset_evidence()

    def _reset_evidence(self):
        self.window.clear()
        self.cooldown.clear()
        if self.vehicles:
            self.vehicles.reset()

    def _geometry(self, size):
        if self._bays is None:
            w, h = size
            self._bays = [BayGeometry(s, Polygon([(x * (w - 1), y * (h - 1)) for x, y in pts])) for s, pts in self.view.polygons.items()]
        return self._bays

    def observe(
        self, ctx: FrameContext, spaces: dict[str, SpaceFrameEvidence], now: datetime, detections: list[dict] | None = None,
    ) -> dict[str, SpaceOpenEvidence]:
        c = self.config
        if self.tracking is None:
            check_radius(spaces, c)
        elif detections is None:
            raise ValueError("tracking mode needs this frame's detections")
        frame_block: list[str] = []
        if ctx.session_id != self.session:
            self._reset(ctx.session_id)
        age_ms = (now - ctx.captured_at).total_seconds() * 1000
        if self.last_seq is not None and ctx.seq <= self.last_seq:
            frame_block.append("out_of_order_frame")
        elif self.last_captured is not None and ctx.captured_at <= self.last_captured:
            frame_block.append("non_monotonic_timestamp")
            self.last_seq = ctx.seq
            self._reset_evidence()
        elif not (-2000 <= age_ms <= c.max_frame_age_ms):
            frame_block.append("stale_frame")
        elif ctx.image_sha256 in self.seen:
            frame_block.append("duplicate_frame")
            self.last_seq = ctx.seq
        else:
            if self.window and (ctx.captured_at - self.window[-1].captured_at).total_seconds() * 1000 > c.max_gap_ms:
                self._reset_evidence()
            self.seen.add(ctx.image_sha256)
            record = _Record(ctx.seq, ctx.captured_at, ctx.image_sha256, spaces)
            previous = self.window[-1] if self.window else None
            motion = self._motion(ctx, detections) if self.tracking else {}
            for sid, ev in spaces.items():
                before = previous.spaces.get(sid) if previous else None
                partial = 0 < ev.vehicle_overlap and not ev.occupied
                changed = before is not None and _appearance_changed(ev, before, c)
                if self.tracking:
                    state, ids = motion.get(sid, ("settled", ()))
                    record.motion[sid], record.tracks[sid] = state, ids
                    record.state[sid] = "suspected" if (partial or changed) and state == "settled" else state
                else:
                    moved = before is not None and _near_motion(ev, before, c)
                    record.state[sid] = "suspected" if partial or changed or moved else "settled"
            self.window.append(record)
            self.last_seq, self.last_captured = ctx.seq, ctx.captured_at
        return {sid: self._space(sid, spaces[sid], frame_block) for sid in spaces}

    def _motion(self, ctx: FrameContext, detections: list[dict]) -> dict[str, tuple[str, tuple[int, ...]]]:
        t = self.tracking
        w, h = ctx.expected_size
        boxes = [(d["label"], d["confidence"], (d["box"][0] * w, d["box"][1] * h, d["box"][2] * w, d["box"][3] * h)) for d in detections]
        ts = ctx.captured_at.timestamp()
        tracks = self.vehicles.update(ctx.seq, ts, boxes)
        bays = self._geometry((w, h))
        per_bay = bay_motion(tracks, bays, t)
        # Tracks deleted this frame keep blocking the bays they were near or heading for.
        if t.lost_cooldown_ms > 0:
            gone = bay_motion([_as_lost(tr) for tr in self.vehicles.lost], bays, t)
            for sid, approaches in gone.items():
                if any(a.state == "lost" for a in approaches):
                    self.cooldown[sid] = max(self.cooldown.get(sid, 0.0), ts + t.lost_cooldown_ms / 1000)
            for sid, approaches in per_bay.items():
                if any(a.state == "lost" for a in approaches):
                    self.cooldown[sid] = max(self.cooldown.get(sid, 0.0), ts + t.lost_cooldown_ms / 1000)
        out = {}
        for sid, approaches in per_bay.items():
            state = bay_state(approaches)
            if state == "settled" and self.cooldown.get(sid, 0.0) >= ts:
                state = "lost"
            out[sid] = (state, tuple(a.track_id for a in approaches if a.state not in ("passing", "stationary")))
        return out

    def _space(self, sid: str, current: SpaceFrameEvidence, frame_block: list[str]) -> SpaceOpenEvidence:
        c = self.config
        recent = list(self.window)[-c.window:]
        passing = [r for r in recent if sid in r.spaces and not r.spaces[sid].blocking(c)]
        consistency = len(passing) / c.window
        states = [r.state.get(sid, "suspected") for r in recent]
        if len(self.window) < 2:
            transition = "unknown"
        else:
            # The most recent non-settled state in the window names the transition.
            transition = next((s for s in reversed(states) if s != "settled"), "settled")
        reasons = list(frame_block) + current.blocking(c)
        if len(self.window) < c.window:
            reasons.append("insufficient_distinct_frames")
        elif len(passing) < c.window:
            reasons.append("temporal_inconsistent")
        if transition != "settled":
            reasons.append(f"transition_{transition}")
        reasons = list(dict.fromkeys(reasons))
        last = self.window[-1] if self.window else None
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
            bay_motion=(last.motion.get(sid, "n/a") if last and self.tracking else "n/a"),
            track_ids=(last.tracks.get(sid, ()) if last and self.tracking else ()),
        )


def _as_lost(track):
    """A deleted track evaluated as lost at its last known box."""
    track.missed = max(track.missed, 1)
    return track
