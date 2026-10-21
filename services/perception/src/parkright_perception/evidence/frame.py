"""Single-frame evidence per calibrated space: validity, visibility, surface, overlap, occlusion.

Every signal is measured from pixels, calibration geometry or detector output. Signals:

- frame validity: detector ready, checkpoint verified, inference completed without error,
  calibration valid, frame dimensions equal to the calibration, frame fresh.
- visibility: fraction of the polygon inside the image × area adequacy × ROI exposure quality.
- marking visibility (positive empty-surface evidence): fraction of samples along the bay's
  painted edges (both sides and the back line; not the aisle edge) where a bright paint line
  stands out from the pavement just inside the bay. A vehicle, pillar or any other object in
  front of or inside the bay hides paint. This does not depend on the detector.
- interior clutter: fraction of the bay's inner region with strong local gradients. Empty
  pavement is smooth; vehicles and objects are not.
- vehicle overlap: largest fraction of the polygon covered by any detection at the model floor.
- foreground cover: largest polygon fraction covered by a detection standing nearer the camera
  than the bay (box bottom below the bay's lowest image point): possible occluders.
- occlusion risk: max(foreground cover, 1 - marking visibility).
- empty-reference match (positive empty evidence): Pearson correlation between the bay's
  rectified, lighting-normalised appearance now and the same bay in operator-confirmed empty
  reference captures (best over references, so no lighting label is needed). A vehicle,
  pillar or anything else in the bay changes its structure. Markings say the bay's
  surroundings are visible; the reference match says its floor looks empty.

Empty references carry provenance (:class:`ReferenceProvenance`): which camera and calibration
they belong to, where the capture came from and how its empty bays were designated. A capture
from a TEST split can never build a reference.

Detections near each bay are collected within ``neighbourhood_px``; the radius is stored on the
evidence (``near_radius_px``) so a motion gate can refuse a larger radius than was collected.
"""

import hashlib
import io
import json
import math
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box

from ..a0.config import A0Config

VEHICLES = frozenset(("car", "truck", "bus", "suv", "van"))


@dataclass(frozen=True)
class EvidenceConfig:
    """Thresholds for readiness. Defaults are deliberately strict; evaluation freezes its own copy."""

    detection_floor: float = 0.05
    occupied_confidence: float = A0Config.occupied_confidence
    occupied_coverage: float = A0Config.occupied_coverage
    min_area_px: float = 1500.0
    min_visibility: float = 0.95
    min_marking_visibility: float = 0.8
    max_interior_clutter: float = 0.05
    max_vehicle_overlap: float = 0.0
    max_occlusion_risk: float = 0.2
    max_appearance_change: float = 0.04
    # Detections within this distance of a bay are kept for its motion gate. Must cover motion_radius_px.
    neighbourhood_px: float = 480.0
    motion_radius_px: float = 40.0
    motion_iou: float = 0.9
    window: int = 5
    max_frame_age_ms: int = 10_000
    max_gap_ms: int = 2_000
    # Marking sampling geometry (pixels).
    marking_samples: int = 24
    line_inner_px: int = 2
    line_outer_fraction: float = 0.15
    pavement_band: tuple[float, float] = (0.2, 0.3)
    min_reference_match: float = 0.8
    reference_size: int = 24
    marking_min_contrast: float = 12.0
    marking_rel_contrast: float = 0.25
    clutter_gradient: float = 18.0
    interior_scale: float = 0.7

    def __post_init__(self):
        if self.window < 1:
            raise ValueError("window must be at least 1")
        if self.neighbourhood_px < self.motion_radius_px:
            raise ValueError(f"neighbourhood_px {self.neighbourhood_px} is smaller than motion_radius_px {self.motion_radius_px}: the gate would silently use the smaller radius")


@dataclass(frozen=True)
class FrameContext:
    """Production status for one frame. No ground truth fields exist here."""

    camera_id: str
    session_id: str
    seq: int
    captured_at: datetime
    image_sha256: str
    detector_ready: bool
    checkpoint_verified: bool
    detector_error: str | None
    calibration_valid: bool
    expected_size: tuple[int, int]


@dataclass(frozen=True)
class ViewGeometry:
    """Calibration polygons (normalised 0..1) and the aisle reference point derived from them."""

    polygons: dict[str, tuple[tuple[float, float], ...]]

    @property
    def aisle_point(self) -> tuple[float, float]:
        # Bays face the aisle, which runs through the middle of the calibrated lot.
        pts = [p for poly in self.polygons.values() for p in poly]
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def bay_patch(gray: np.ndarray, quad: list[tuple[float, float]], size: int) -> np.ndarray:
    """The bay rectified to size×size by bilinear quad sampling (2× supersampled), zero-mean unit-variance."""
    (ax, ay), (bx, by), (cx, cy), (dx, dy) = quad  # calibration order: TL, TR, BR, BL
    n = size * 2
    u, v = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n)
    x = (1 - v) * ((1 - u) * ax + u * bx) + v * ((1 - u) * dx + u * cx)
    y = (1 - v) * ((1 - u) * ay + u * by) + v * ((1 - u) * dy + u * cy)
    h, w = gray.shape
    xi, yi = np.clip(np.rint(x).astype(int), 0, w - 1), np.clip(np.rint(y).astype(int), 0, h - 1)
    patch = gray[yi, xi].reshape(size, 2, size, 2).mean(axis=(1, 3))
    return (patch - patch.mean()) / (patch.std() + 1e-3)


def _expanded(poly, factor=1.1):
    cx, cy = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    return [(cx + (x - cx) * factor, cy + (y - cy) * factor) for x, y in poly]


REFERENCE_SOURCE_SPLITS = frozenset(("reference", "calibration", "dev"))


@dataclass(frozen=True)
class ReferenceProvenance:
    """Where one empty-reference capture came from. ``empty_spaces``: bays designated empty in it."""

    camera_id: str
    calibration_version: str
    source_split: str
    category: str
    image_sha256: str
    source_id: str
    method: str
    empty_spaces: tuple[str, ...]

    def to_dict(self) -> dict:
        return {k: (list(v) if isinstance(v, tuple) else v) for k, v in self.__dict__.items()}


def provenance_sha256(entries: list[ReferenceProvenance]) -> str:
    """Aggregate hash over every reference's provenance, including each image's SHA-256."""
    rows = sorted((e.to_dict() for e in entries), key=lambda d: (d["image_sha256"], d["source_id"]))
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class EmptyReference:
    """Per-bay appearance from operator-confirmed EMPTY captures of this camera (calibration-time input)."""

    def __init__(self, patches: dict[str, list[np.ndarray]], size: int, provenance: tuple[ReferenceProvenance, ...] = ()):
        self.patches, self.size, self.provenance = patches, size, provenance

    @property
    def aggregate_sha256(self) -> str | None:
        return provenance_sha256(list(self.provenance)) if self.provenance else None

    @classmethod
    def from_provenance(
        cls, captures: list[tuple[ReferenceProvenance, bytes]], view: "ViewGeometry", camera_id: str, calibration_version: str, size: int = 24,
    ) -> "EmptyReference":
        """Builds references only from captures whose provenance is acceptable; anything else raises."""
        patches: dict[str, list[np.ndarray]] = {s: [] for s in view.polygons}
        for meta, data in captures:
            if meta.source_split not in REFERENCE_SOURCE_SPLITS:
                raise ValueError(f"reference {meta.source_id}: split {meta.source_split!r} may not build empty references")
            if hashlib.sha256(data).hexdigest() != meta.image_sha256:
                raise ValueError(f"reference {meta.source_id}: image does not match its recorded SHA-256")
            if meta.camera_id != camera_id or meta.calibration_version != calibration_version:
                raise ValueError(f"reference {meta.source_id}: captured for {meta.camera_id}/{meta.calibration_version}")
            unknown = set(meta.empty_spaces) - set(view.polygons)
            if unknown:
                raise ValueError(f"reference {meta.source_id}: unknown spaces {sorted(unknown)}")
            with Image.open(io.BytesIO(data)) as image:
                w, h = image.size
                gray = np.asarray(image.convert("L"), dtype=np.float32)
            for s in meta.empty_spaces:
                patches[s].append(bay_patch(gray, _expanded(_px(view.polygons[s], w, h)), size))
        return cls(patches, size, tuple(meta for meta, _ in captures))

    @classmethod
    def from_images(cls, images: list[Image.Image], view: "ViewGeometry", size: int = 24) -> "EmptyReference":
        patches: dict[str, list[np.ndarray]] = {s: [] for s in view.polygons}
        for image in images:
            w, h = image.size
            gray = np.asarray(image.convert("L"), dtype=np.float32)
            for s, points in view.polygons.items():
                patches[s].append(bay_patch(gray, _expanded(_px(points, w, h)), size))
        return cls(patches, size)

    def match(self, space_id: str, gray: np.ndarray, poly: list[tuple[float, float]]) -> float:
        refs = self.patches.get(space_id) or []
        if not refs:
            return 0.0
        now = bay_patch(gray, _expanded(poly), self.size)
        return max(float((now * r).mean()) for r in refs)


@dataclass(frozen=True)
class SpaceFrameEvidence:
    space_id: str
    frame_valid: bool
    frame_reasons: tuple[str, ...]
    visibility_score: float
    marking_visibility: float
    interior_clutter: float
    vehicle_overlap: float
    foreground_cover: float
    occlusion_risk: float
    occupied: bool
    reference_match: float
    signature: tuple[float, ...] = field(repr=False)
    # Detections near the bay: (x0, y0, x1, y1, distance to the polygon in px).
    near_boxes: tuple[tuple[float, float, float, float, float], ...] = field(repr=False)
    # Radius near_boxes were collected within; 0 means unknown (no motion gate can rely on them).
    near_radius_px: float = 0.0

    def blocking(self, c: EvidenceConfig) -> list[str]:
        out = [f"frame:{r}" for r in self.frame_reasons]
        if self.occupied:
            out.append("occupied_evidence")
        if self.visibility_score < c.min_visibility:
            out.append("insufficient_visibility")
        if self.vehicle_overlap > c.max_vehicle_overlap:
            out.append("vehicle_overlap")
        if self.occlusion_risk > c.max_occlusion_risk:
            out.append("occlusion_risk")
        if self.marking_visibility < c.min_marking_visibility:
            out.append("markings_not_visible")
        if self.interior_clutter > c.max_interior_clutter:
            out.append("interior_not_clear")
        if self.reference_match < c.min_reference_match:
            out.append("no_empty_reference_match")
        return out


def frame_reasons(ctx: FrameContext, size: tuple[int, int], now: datetime, c: EvidenceConfig) -> list[str]:
    reasons = []
    if not ctx.detector_ready:
        reasons.append("detector_not_ready")
    if not ctx.checkpoint_verified:
        reasons.append("checkpoint_not_verified")
    if ctx.detector_error:
        reasons.append("detector_error")
    if not ctx.calibration_valid:
        reasons.append("calibration_invalid")
    if size != ctx.expected_size:
        reasons.append("frame_size_mismatch")
    age_ms = (now - ctx.captured_at).total_seconds() * 1000
    if not (-2000 <= age_ms <= c.max_frame_age_ms):
        reasons.append("frame_stale")
    return reasons


def _px(points, w, h):
    return [(x * (w - 1), y * (h - 1)) for x, y in points]


def _sample(gray: np.ndarray, x: float, y: float) -> float | None:
    h, w = gray.shape
    xi, yi = int(round(x)), int(round(y))
    if 0 <= xi < w and 0 <= yi < h:
        return float(gray[yi, xi])
    return None


def marking_visibility(gray: np.ndarray, poly: list[tuple[float, float]], aisle: tuple[float, float], c: EvidenceConfig) -> float:
    cx, cy = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    edges = [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
    # The aisle edge has no paint; it is the edge whose midpoint is nearest the aisle point.
    mids = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in edges]
    aisle_edge = min(range(len(edges)), key=lambda i: math.dist(mids[i], aisle))
    visible = total = 0
    for i, (a, b) in enumerate(edges):
        if i == aisle_edge:
            continue
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        depth = (cx - mids[i][0]) * nx + (cy - mids[i][1]) * ny
        if depth < 0:
            nx, ny, depth = -nx, -ny, -depth  # inward normal; depth = edge-to-centre distance
        # Paint lies on or just outside the calibrated interior; pavement is sampled well inside,
        # clear of wheel stops.
        outer = max(4, round(c.line_outer_fraction * 2 * depth))
        band = range(max(3, round(c.pavement_band[0] * 2 * depth)), max(4, round(c.pavement_band[1] * 2 * depth)) + 1)
        for k in range(c.marking_samples):
            t = 0.12 + 0.76 * k / max(1, c.marking_samples - 1)
            px, py = a[0] + t * dx, a[1] + t * dy
            total += 1
            line = [_sample(gray, px + s * nx, py + s * ny) for s in range(-outer, c.line_inner_px + 1)]
            inner = [_sample(gray, px + s * nx, py + s * ny) for s in band]
            if None in line or None in inner:
                continue
            peak, ground = max(line), float(np.median(inner))
            if peak - ground >= max(c.marking_min_contrast, c.marking_rel_contrast * ground):
                visible += 1
    return visible / total if total else 0.0


def _interior(poly, scale):
    cx, cy = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    return [(cx + (x - cx) * scale, cy + (y - cy) * scale) for x, y in poly]


def frame_evidence(
    image: Image.Image, ctx: FrameContext, view: ViewGeometry, detections: list[dict], now: datetime,
    c: EvidenceConfig = EvidenceConfig(), reference: EmptyReference | None = None,
) -> dict[str, SpaceFrameEvidence]:
    """detections: dicts with label, confidence and normalised xyxy box (detector output)."""
    w, h = image.size
    reasons = tuple(frame_reasons(ctx, (w, h), now, c))
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    grad = np.zeros_like(gray)
    grad[:, 1:] = np.abs(np.diff(gray, axis=1))
    grad[1:, :] = np.maximum(grad[1:, :], np.abs(np.diff(gray, axis=0)))
    aisle = (view.aisle_point[0] * (w - 1), view.aisle_point[1] * (h - 1))
    frame_rect = box(0, 0, w - 1, h - 1)
    boxes = [
        (d, box(d["box"][0] * w, d["box"][1] * h, d["box"][2] * w, d["box"][3] * h))
        for d in detections
        if d["confidence"] >= c.detection_floor
    ]
    quality = A0Config()
    out = {}
    for space_id, points in view.polygons.items():
        poly = _px(points, w, h)
        shape = Polygon(poly)
        if not shape.is_valid or shape.area <= 0:
            out[space_id] = SpaceFrameEvidence(space_id, False, reasons + ("polygon_invalid",), 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, False, 0.0, (), ())
            continue
        in_frame = shape.intersection(frame_rect).area / shape.area
        mask = Image.new("1", (w, h))
        ImageDraw.Draw(mask).polygon(poly, fill=1)
        roi = gray[np.asarray(mask, dtype=bool)]
        exposed = roi.size >= quality.min_roi_pixels and quality.min_brightness <= roi.mean() <= quality.max_brightness and roi.std() >= quality.min_contrast
        visibility = in_frame * min(1.0, shape.area / c.min_area_px) * (1.0 if exposed else 0.0)
        inner = Image.new("1", (w, h))
        ImageDraw.Draw(inner).polygon(_interior(poly, c.interior_scale), fill=1)
        inner_mask = np.asarray(inner, dtype=bool)
        clutter = float((grad[inner_mask] > c.clutter_gradient).mean()) if inner_mask.any() else 1.0
        # A coarse appearance signature of the bay interior, for change detection over time.
        x0, y0, x1, y1 = (int(v) for v in shape.bounds)
        cells = []
        for gy in range(4):
            for gx in range(4):
                xa, xb = x0 + (x1 - x0) * gx // 4, x0 + (x1 - x0) * (gx + 1) // 4 + 1
                ya, yb = y0 + (y1 - y0) * gy // 4, y0 + (y1 - y0) * (gy + 1) // 4 + 1
                cell = gray[ya:yb, xa:xb][inner_mask[ya:yb, xa:xb]]
                cells.append(float(cell.mean()) if cell.size else -1.0)
        overlap = foreground = 0.0
        occupied = False
        bottom = max(p[1] for p in poly)
        hood = shape.buffer(c.neighbourhood_px)
        near = []
        for d, b in boxes:
            cover = shape.intersection(b).area / shape.area
            overlap = max(overlap, cover)
            if b.bounds[3] > bottom + 2:
                foreground = max(foreground, cover)
            if d["label"] in VEHICLES and d["confidence"] >= c.occupied_confidence and cover >= c.occupied_coverage:
                occupied = True
            if b.intersects(hood):
                near.append((*b.bounds, round(shape.distance(b), 2)))
        marking = marking_visibility(gray, poly, aisle, c)
        out[space_id] = SpaceFrameEvidence(
            space_id=space_id,
            frame_valid=not reasons,
            frame_reasons=reasons,
            visibility_score=round(visibility, 4),
            marking_visibility=round(marking, 4),
            interior_clutter=round(clutter, 4),
            vehicle_overlap=round(overlap, 4),
            foreground_cover=round(foreground, 4),
            occlusion_risk=round(max(foreground, 1 - marking), 4),
            occupied=occupied,
            reference_match=round(reference.match(space_id, gray, poly), 4) if reference else 0.0,
            signature=tuple(cells),
            near_boxes=tuple(near),
            near_radius_px=c.neighbourhood_px,
        )
    return out
