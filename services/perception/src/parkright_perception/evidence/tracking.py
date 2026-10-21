"""Lightweight vehicle tracking over A2 detections and per-bay approach estimation (EVALUATION ONLY).

No new model: tracks are built from the production detector's boxes on consecutive distinct
frames of one session. Everything is in image pixels; nothing here reads ground truth.

Association (deterministic, greedy):
  1. each live track predicts its box at the new frame time from its velocity;
  2. a (track, detection) pair is a candidate when the labels are compatible and either the
     IoU with the predicted box is at least ``assoc_iou`` or the anchor distance is within the
     gate ``max(assoc_distance_px, assoc_distance_frac × box diagonal)``;
  3. cost = (1 − IoU) + distance / gate; candidates are taken in order of (cost, track id,
     detection index), each track and detection at most once;
  4. a match is *ambiguous* when another candidate for the same track or the same detection
     is within ``ambiguity_margin`` of its cost. Ambiguous tracks are treated as unknown motion.
Unmatched detections start new tracks; unmatched tracks are *lost* for up to ``max_missed``
frames (then deleted). Loss is never read as "gone": see :func:`bay_motion`.

Approach vector, per (track, bay), anchor = bottom centre of the box (ground contact):
  v        velocity (px/s), from the anchor ``velocity_frames`` observations ago to now;
  d        vector from the anchor to the bay polygon centroid;
  cos      v·d / (|v| |d|);
  closing  distance(anchor, polygon) then − now (positive when the vehicle gets closer);
  path     the anchor extrapolated along v for ``horizon_ms`` enters the polygon grown by
           ``path_margin_px``; ttb is the first such time (projected time-to-bay).
  approaching = enough history ∧ |v| ≥ speed floor ∧ closing ≥ min_closing ∧ cos ≥ min_cos ∧ path
"""

import math
from collections import deque
from dataclasses import dataclass, field

from shapely.geometry import LineString, Point, Polygon, box

VEHICLE_LABELS = frozenset(("car", "truck", "bus", "suv", "van", "pickup"))


@dataclass(frozen=True)
class TrackingConfig:
    detection_floor: float = 0.3
    labels: frozenset[str] = VEHICLE_LABELS
    # Labels that may continue one track; anything else is a class mismatch (new track).
    compatible: tuple[frozenset[str], ...] = ()
    assoc_iou: float = 0.3
    assoc_distance_px: float = 60.0
    assoc_distance_frac: float = 1.0
    ambiguity_margin: float = 0.1
    max_missed: int = 2
    min_history: int = 3
    velocity_frames: int = 2
    speed_floor_px_s: float = 20.0
    min_closing_px: float = 3.0
    min_cos: float = 0.0
    horizon_ms: float = 3000.0
    path_margin_px: float = 10.0
    relevant_px: float = 400.0
    near_px: float = 25.0
    # Uncertain tracks (young, ambiguously associated or lost) block bays within this distance.
    uncertain_near_px: float = 60.0
    lost_cooldown_ms: float = 0.0
    # After a track approached a bay, that bay stays blocked (ambiguous) for this long, and for as
    # long as the track remains within uncertain_near_px of it: an aborted approach clears only
    # once the vehicle is clearly away.
    approach_latch_ms: float = 1500.0
    departing_overlap: float = 0.1
    parked_overlap: float = 0.45

    def __post_init__(self):
        if self.min_history < 2 or self.velocity_frames < 1 or self.max_missed < 0:
            raise ValueError("tracking needs min_history ≥ 2, velocity_frames ≥ 1, max_missed ≥ 0")


def _iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def anchor(b) -> tuple[float, float]:
    return ((b[0] + b[2]) / 2, b[3])


def centroid(b) -> tuple[float, float]:
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


@dataclass
class Track:
    track_id: int
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]
    last_t: float
    last_seq: int
    history: deque = field(default_factory=lambda: deque(maxlen=16))  # (seq, t, anchor, centroid, bbox)
    age: int = 1
    missed: int = 0
    ambiguous: bool = False
    max_speed: float = 0.0
    approached: dict = field(default_factory=dict)  # space_id → last time (s) this track was approaching it

    @property
    def centroid(self):
        return centroid(self.bbox)

    @property
    def previous_centroids(self):
        return [h[3] for h in list(self.history)[:-1]]

    def velocity(self, c: TrackingConfig, min_history: int | None = None) -> tuple[float, float] | None:
        """Anchor velocity (px/s) over the last ``velocity_frames`` observations; None until enough history."""
        h = list(self.history)
        if len(h) < (c.min_history if min_history is None else min_history):
            return None
        old, new = h[-1 - min(c.velocity_frames, len(h) - 1)], h[-1]
        dt = new[1] - old[1]
        if dt <= 0:
            return None
        return ((new[2][0] - old[2][0]) / dt, (new[2][1] - old[2][1]) / dt)

    def predicted(self, t: float, c: TrackingConfig):
        # Prediction may use two observations; motion classification waits for min_history.
        v = self.velocity(c, min_history=2) or (0.0, 0.0)
        dt = t - self.last_t
        x0, y0, x1, y1 = self.bbox
        return (x0 + v[0] * dt, y0 + v[1] * dt, x1 + v[0] * dt, y1 + v[1] * dt)

    def to_dict(self, c: TrackingConfig) -> dict:
        v = self.velocity(c)
        return {
            "track_id": self.track_id, "class": self.label, "confidence": round(self.confidence, 4),
            "bbox": [round(x, 1) for x in self.bbox], "centroid": [round(x, 1) for x in self.centroid],
            "previous_centroids": [[round(x, 1) for x in p] for p in self.previous_centroids[-4:]],
            "velocity_px_s": None if v is None else [round(v[0], 1), round(v[1], 1)],
            "age": self.age, "missed": self.missed, "last_t": self.last_t, "last_seq": self.last_seq, "ambiguous": self.ambiguous,
        }


class VehicleTracker:
    """Per-camera, per-session tracks. ``update`` once per accepted distinct frame, in order."""

    def __init__(self, config: TrackingConfig = TrackingConfig()):
        self.config = config
        self.tracks: list[Track] = []
        self.lost: list[Track] = []  # tracks deleted on this update (missed > max_missed)
        self._next = 1

    def reset(self):
        self.tracks, self.lost, self._next = [], [], 1

    def _compatible(self, a: str, b: str) -> bool:
        return a == b or any(a in g and b in g for g in self.config.compatible)

    def update(self, seq: int, t: float, boxes: list[tuple[str, float, tuple[float, float, float, float]]]) -> list[Track]:
        """boxes: (label, confidence, xyxy px). Returns live tracks (matched this frame or still within max_missed)."""
        c = self.config
        dets = [(lab, conf, b) for lab, conf, b in boxes if lab in c.labels and conf >= c.detection_floor]
        cands = []
        for ti, tr in enumerate(self.tracks):
            pred = tr.predicted(t, c)
            pa = anchor(pred)
            gate = max(c.assoc_distance_px, c.assoc_distance_frac * math.hypot(pred[2] - pred[0], pred[3] - pred[1]))
            for di, (lab, _, b) in enumerate(dets):
                if not self._compatible(tr.label, lab):
                    continue
                iou = _iou(pred, b)
                dist = math.dist(pa, anchor(b))
                if iou >= c.assoc_iou or dist <= gate:
                    cands.append(((1 - iou) + dist / gate, tr.track_id, di, ti))
        cands.sort()
        used_t, used_d, matches = set(), set(), []
        for cost, _, di, ti in cands:
            if ti in used_t or di in used_d:
                continue
            used_t.add(ti)
            used_d.add(di)
            matches.append((cost, ti, di))
        for tr in self.tracks:
            tr.ambiguous = False
        for cost, ti, di in matches:
            rivals = [x for x in cands if (x[3] == ti) != (x[2] == di) and x[0] <= cost + c.ambiguity_margin]
            if rivals:
                self.tracks[ti].ambiguous = True
                for x in rivals:
                    self.tracks[x[3]].ambiguous = True
        for _, ti, di in matches:
            tr = self.tracks[ti]
            lab, conf, b = dets[di]
            tr.label, tr.confidence, tr.bbox = lab, conf, b
            tr.history.append((seq, t, anchor(b), centroid(b), b))
            tr.last_t, tr.last_seq, tr.missed = t, seq, 0
            tr.age += 1
            v = tr.velocity(c)
            if v is not None:
                tr.max_speed = max(tr.max_speed, math.hypot(*v))
        for ti, tr in enumerate(self.tracks):
            if ti not in used_t:
                tr.missed += 1
                tr.age += 1
        self.lost = [tr for tr in self.tracks if tr.missed > c.max_missed]
        self.tracks = [tr for tr in self.tracks if tr.missed <= c.max_missed]
        for di, (lab, conf, b) in enumerate(dets):
            if di not in used_d:
                tr = Track(self._next, lab, conf, b, t, seq)
                tr.history.append((seq, t, anchor(b), centroid(b), b))
                self.tracks.append(tr)
                self._next += 1
        return self.tracks


@dataclass(frozen=True)
class BayGeometry:
    space_id: str
    polygon: Polygon

    @property
    def target(self) -> tuple[float, float]:
        p = self.polygon.centroid
        return (p.x, p.y)


@dataclass(frozen=True)
class Approach:
    track_id: int
    state: str  # approaching | departing | ambiguous | lost | paused | passing | stationary
    gap_px: float
    speed_px_s: float | None
    cos: float | None
    closing_px: float | None
    ttb_ms: float | None


def _approach(tr: Track, bay: BayGeometry, c: TrackingConfig, others: list[BayGeometry]) -> Approach | None:
    b = box(*tr.bbox)
    gap = bay.polygon.distance(b)
    if gap > c.relevant_px:
        return None
    if tr.missed > 0:
        return Approach(tr.track_id, "lost", gap, None, None, None, None) if gap <= c.uncertain_near_px else None
    v = tr.velocity(c)
    if v is None or tr.ambiguous:
        return Approach(tr.track_id, "ambiguous", gap, None, None, None, None) if gap <= c.uncertain_near_px else None
    speed = math.hypot(*v)
    now = anchor(tr.bbox)
    h = list(tr.history)
    then = h[-1 - min(c.velocity_frames, len(h) - 1)][2]
    dist_now, dist_then = bay.polygon.distance(Point(now)), bay.polygon.distance(Point(then))
    closing = dist_then - dist_now
    overlapped = any(bay.polygon.intersection(box(*x[4])).area / bay.polygon.area >= c.departing_overlap for x in h)
    if speed < c.speed_floor_px_s:
        parked_elsewhere = any(o.space_id != bay.space_id and o.polygon.intersection(b).area / o.polygon.area >= c.parked_overlap for o in others)
        if tr.max_speed >= c.speed_floor_px_s and gap <= c.near_px and not parked_elsewhere:
            return Approach(tr.track_id, "paused", gap, speed, None, closing, None)
        return Approach(tr.track_id, "stationary", gap, speed, None, closing, None)
    d = (bay.target[0] - now[0], bay.target[1] - now[1])
    nd = math.hypot(*d)
    cos = 1.0 if nd < 1e-6 else (v[0] * d[0] + v[1] * d[1]) / (speed * nd)
    reach = c.horizon_ms / 1000
    end = (now[0] + v[0] * reach, now[1] + v[1] * reach)
    grown = bay.polygon.buffer(c.path_margin_px)
    ttb = None
    if grown.contains(Point(now)):
        ttb = 0.0
    else:
        hit = LineString([now, end]).intersection(grown)
        if not hit.is_empty:
            ttb = min(math.dist(now, p) for p in _points(hit)) / speed * 1000
    if overlapped and closing <= 0:
        return Approach(tr.track_id, "departing", gap, speed, cos, closing, ttb)
    if closing >= c.min_closing_px and cos >= c.min_cos and ttb is not None:
        return Approach(tr.track_id, "approaching", gap, speed, cos, closing, ttb)
    if gap <= c.near_px and closing > -c.min_closing_px:
        return Approach(tr.track_id, "ambiguous", gap, speed, cos, closing, ttb)
    return Approach(tr.track_id, "passing", gap, speed, cos, closing, ttb)


def _points(geom):
    if hasattr(geom, "geoms"):
        for g in geom.geoms:
            yield from _points(g)
    else:
        yield from geom.coords


BLOCKING = ("approaching", "departing", "lost", "ambiguous", "paused")


def _latched(tr: Track, bay: BayGeometry, c: TrackingConfig, a: Approach | None) -> Approach | None:
    if a is not None and a.state == "approaching":
        tr.approached[bay.space_id] = tr.last_t
        return a
    since = tr.approached.get(bay.space_id)
    if since is None or a is not None and a.state in ("lost", "departing", "ambiguous"):
        return a
    gap = a.gap_px if a is not None else bay.polygon.distance(box(*tr.bbox))
    if tr.last_t - since <= c.approach_latch_ms / 1000 or gap <= c.uncertain_near_px:
        return Approach(tr.track_id, "ambiguous", gap, a.speed_px_s if a else None, a.cos if a else None, a.closing_px if a else None, None)
    return a


def bay_motion(tracks: list[Track], bays: list[BayGeometry], c: TrackingConfig) -> dict[str, list[Approach]]:
    """Per bay: every relevant track's motion relative to it (blocking or not)."""
    out = {}
    for bay in bays:
        rel = [a for tr in tracks if (a := _latched(tr, bay, c, _approach(tr, bay, c, bays))) is not None]
        out[bay.space_id] = sorted(rel, key=lambda a: (BLOCKING.index(a.state) if a.state in BLOCKING else 9, a.track_id))
    return out


def bay_state(approaches: list[Approach]) -> str:
    """The single most conservative state for a bay this frame; ``settled`` when nothing relevant blocks it."""
    for state in BLOCKING:
        if any(a.state == state for a in approaches):
            return "ambiguous" if state == "paused" else state
    return "settled"
