"""Offline A2 domain-gap analysis; never changes ParkRight production inference.

Consumes either an A1 evaluation bundle (``parkright-evaluation-v1``) or the
documented A2 canonical manifest. Raw SSD scores are collected at A0's existing
0.01 detector floor. Controlled image variants are diagnostic inputs only.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import math
import statistics
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageEnhance, ImageOps
from shapely.geometry import Polygon, box as shapely_box

from parkright_perception.a0.nvidia_ssd import NvidiaSSD


COCO_CONTIGUOUS = (
    "background", "person", "bicycle", "car", "motorcycle", "airplane",
    "bus", "train", "truck", "boat", "traffic light", "fire hydrant",
    "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse",
    "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis",
    "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass",
    "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv",
    "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
    "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
)
VEHICLES = {"car", "motorcycle", "bus", "truck"}
HISTOGRAM_BINS = (0.01, 0.02, 0.05, 0.10, 0.20, 0.40, 0.65, 1.000001)


@dataclass
class Sample:
    frame_id: str
    image: Image.Image
    image_sha256: str
    seed: int | None
    preset: str | None
    occupied_spaces: tuple[str, ...]
    objects: tuple[dict[str, Any], ...]
    latency_ms: float | None
    recorded_diagnostics: dict[str, Any] | None


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode_jpeg(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as opened:
        return opened.copy()


def load_samples(path: Path) -> tuple[list[Sample], str]:
    """Load A1 export JSON or the canonical A2 manifest documented in README."""
    payload = json.loads(path.read_text())
    schema = payload.get("schema")
    if schema == "parkright-evaluation-v1":
        samples = []
        for index, record in enumerate(payload["records"]):
            jpeg = base64.b64decode(record["jpeg_base64"], validate=True)
            scenario = record.get("scenario", {})
            truth = record.get("ground_truth", {}).get("spaces", [])
            occupied = tuple(
                item["space_id"] for item in truth if item["truth"] == "occupied"
            )
            metadata = record.get("metadata", {})
            frame_id = f'{metadata.get("session_id", "frame")}:{metadata.get("seq", index)}'
            samples.append(
                Sample(
                    frame_id=frame_id,
                    image=_decode_jpeg(jpeg),
                    image_sha256=_sha256(jpeg),
                    seed=scenario.get("seed"),
                    preset=scenario.get("preset"),
                    occupied_spaces=occupied,
                    objects=(),
                    latency_ms=record.get("latency_ms"),
                    recorded_diagnostics=record.get("diagnostics"),
                )
            )
        return samples, schema
    if schema == "parkright-a2-dataset-v1":
        samples = []
        for record in payload["frames"]:
            image_path = path.parent / record["image_path"]
            jpeg = image_path.read_bytes()
            objects = tuple(record.get("objects", ()))
            occupied = tuple(
                sorted({o["space_id"] for o in objects if o.get("space_id")})
            )
            samples.append(
                Sample(
                    frame_id=record["frame_id"],
                    image=_decode_jpeg(jpeg),
                    image_sha256=_sha256(jpeg),
                    seed=record.get("seed"),
                    preset=record.get("preset"),
                    occupied_spaces=occupied,
                    objects=objects,
                    latency_ms=None,
                    recorded_diagnostics=None,
                )
            )
        return samples, schema
    raise ValueError(f"unsupported dataset schema: {schema!r}")


def image_metrics(image: Image.Image) -> dict[str, Any]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    edge = np.pad(gx, ((0, 0), (0, 1))) + np.pad(gy, ((0, 1), (0, 0)))
    hsv = np.asarray(image.convert("HSV"), dtype=np.float32)
    exif = image.getexif()
    return {
        "width": image.width,
        "height": image.height,
        "mode": image.mode,
        "source_dtype": str(rgb.dtype),
        "source_range": [int(rgb.min()), int(rgb.max())],
        "channel_mean_rgb": [round(float(v), 4) for v in rgb.mean(axis=(0, 1))],
        "luminance_mean": round(float(gray.mean()), 4),
        "luminance_std": round(float(gray.std()), 4),
        "mean_saturation": round(float(hsv[:, :, 1].mean()), 4),
        "mean_edge_strength": round(float(edge.mean()), 4),
        "edge_density_gt_20": round(float((edge > 20).mean()), 6),
        "exif_orientation": exif.get(274),
        "has_alpha": "A" in image.getbands(),
    }


def histogram(values: Iterable[float]) -> list[dict[str, Any]]:
    values = list(values)
    low = 0.0
    result = []
    for high in HISTOGRAM_BINS:
        result.append(
            {
                "from_inclusive": low,
                "to_exclusive": high,
                "count": sum(low <= value < high for value in values),
            }
        )
        low = high
    return result


def _nms_detailed(detector: NvidiaSSD, image: Image.Image) -> tuple[list[dict[str, Any]], float]:
    """Mirror A0 preprocessing/NMS while retaining original COCO class names."""
    import torch
    from torchvision.ops import nms

    if detector._model is None:
        detector._load()
    pixels = np.asarray(
        image.convert("RGB").resize((300, 300), Image.Resampling.BILINEAR),
        dtype=np.float32,
    )
    tensor = torch.from_numpy(
        (pixels / 255.0 * 2.0 - 1.0).transpose(2, 0, 1).copy()
    )
    started = time.perf_counter()
    with torch.inference_mode():
        loc, logits = detector._model(tensor.unsqueeze(0).to(detector.device))
        boxes, probabilities = detector._encoder.scale_back_batch(
            loc.float().cpu(), logits.float().cpu()
        )
        detections = []
        for class_id in range(1, probabilities.shape[-1]):
            scores = probabilities[0, :, class_id]
            mask = scores >= detector.config.detector_min_score
            candidate_boxes = boxes[0, mask].clamp(0, 1)
            candidate_scores = scores[mask]
            keep = nms(
                candidate_boxes,
                candidate_scores,
                detector.config.detector_nms_iou,
            )
            for index in keep:
                box = [round(float(v), 8) for v in candidate_boxes[index].tolist()]
                detections.append(
                    {
                        "class_id": class_id,
                        "label": COCO_CONTIGUOUS[class_id],
                        "confidence": float(candidate_scores[index]),
                        "box": box,
                        "box_width_300": round((box[2] - box[0]) * 300, 3),
                        "box_height_300": round((box[3] - box[1]) * 300, 3),
                    }
                )
    return sorted(detections, key=lambda d: d["confidence"], reverse=True), (
        time.perf_counter() - started
    ) * 1000


def _box_intersection(box: list[float], roi: tuple[float, float, float, float]) -> float:
    x1, y1 = max(box[0], roi[0]), max(box[1], roi[1])
    x2, y2 = min(box[2], roi[2]), min(box[3], roi[3])
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def calibration_rois(path: Path) -> dict[str, tuple[float, float, float, float]]:
    calibration = json.loads(path.read_text())
    return {
        name: (
            min(p["x"] for p in points),
            min(p["y"] for p in points),
            max(p["x"] for p in points),
            max(p["y"] for p in points),
        )
        for name, points in calibration["polygons"].items()
    }


def calibration_polygons(path: Path) -> dict[str, Polygon]:
    calibration = json.loads(path.read_text())
    return {
        name: Polygon((point["x"], point["y"]) for point in points)
        for name, points in calibration["polygons"].items()
    }


def estimate_object_scales(
    samples: list[Sample], rois: dict[str, tuple[float, float, float, float]]
) -> list[dict[str, Any]]:
    """Estimate visible vehicle+shadow extents by differencing matched empty frames."""
    empty = {
        (sample.seed, sample.preset): sample
        for sample in samples
        if not sample.occupied_spaces
    }
    rows = []
    for sample in samples:
        reference = empty.get((sample.seed, sample.preset))
        if reference is None or not sample.occupied_spaces:
            continue
        rgb = np.asarray(sample.image.convert("RGB"), dtype=np.int16)
        baseline = np.asarray(reference.image.convert("RGB"), dtype=np.int16)
        if rgb.shape != baseline.shape:
            continue
        difference = np.max(np.abs(rgb - baseline), axis=2)
        for space_id in sample.occupied_spaces:
            if space_id not in rois:
                continue
            x1, y1, x2, y2 = rois[space_id]
            pad_x, pad_y = (x2 - x1) * 0.25, (y2 - y1) * 0.20
            left = max(0, int((x1 - pad_x) * sample.image.width))
            right = min(sample.image.width, math.ceil((x2 + pad_x) * sample.image.width))
            top = max(0, int((y1 - pad_y) * sample.image.height))
            bottom = min(sample.image.height, math.ceil((y2 + pad_y) * sample.image.height))
            ys, xs = np.where(difference[top:bottom, left:right] > 18)
            if not len(xs):
                continue
            bx1, bx2 = left + int(xs.min()), left + int(xs.max()) + 1
            by1, by2 = top + int(ys.min()), top + int(ys.max()) + 1
            width, height = bx2 - bx1, by2 - by1
            rows.append(
                {
                    "frame_id": sample.frame_id,
                    "space_id": space_id,
                    "row": "near" if space_id.startswith("B") else "far",
                    "source_width_px": width,
                    "source_height_px": height,
                    "ssd_width_px": round(width * 300 / sample.image.width, 3),
                    "ssd_height_px": round(height * 300 / sample.image.height, 3),
                    "source_area_percent": round(
                        100 * width * height / (sample.image.width * sample.image.height), 5
                    ),
                    "method": "matched-empty absolute RGB difference >18; includes shadow",
                }
            )
    return rows


def controlled_variants(image: Image.Image) -> dict[str, Image.Image]:
    rgb = image.convert("RGB")
    side = max(rgb.size)
    letterbox = Image.new("RGB", (side, side), (114, 114, 114))
    letterbox.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
    gamma_08 = Image.fromarray(
        np.uint8(np.clip((np.asarray(rgb, dtype=np.float32) / 255) ** 0.8 * 255, 0, 255))
    )
    gamma_12 = Image.fromarray(
        np.uint8(np.clip((np.asarray(rgb, dtype=np.float32) / 255) ** 1.2 * 255, 0, 255))
    )

    def jpeg_roundtrip(quality: int) -> Image.Image:
        buffer = io.BytesIO()
        rgb.save(buffer, "JPEG", quality=quality)
        return _decode_jpeg(buffer.getvalue()).convert("RGB")

    return {
        "baseline": rgb,
        "letterbox_gray": letterbox,
        "pre_resize_bicubic": rgb.resize((300, 300), Image.Resampling.BICUBIC),
        "pre_resize_lanczos": rgb.resize((300, 300), Image.Resampling.LANCZOS),
        "autocontrast": ImageOps.autocontrast(rgb, cutoff=1),
        "contrast_1.2": ImageEnhance.Contrast(rgb).enhance(1.2),
        "brightness_1.2": ImageEnhance.Brightness(rgb).enhance(1.2),
        "gamma_0.8": gamma_08,
        "gamma_1.2": gamma_12,
        "jpeg_q50": jpeg_roundtrip(50),
        "jpeg_q95": jpeg_roundtrip(95),
    }


def local_crops(
    sample: Sample, rois: dict[str, tuple[float, float, float, float]]
) -> Iterable[tuple[str, Image.Image]]:
    for space_id in sample.occupied_spaces:
        if space_id not in rois:
            continue
        x1, y1, x2, y2 = rois[space_id]
        pad_x, pad_y = (x2 - x1) * 0.6, (y2 - y1) * 0.6
        box = (
            max(0, int((x1 - pad_x) * sample.image.width)),
            max(0, int((y1 - pad_y) * sample.image.height)),
            min(sample.image.width, math.ceil((x2 + pad_x) * sample.image.width)),
            min(sample.image.height, math.ceil((y2 + pad_y) * sample.image.height)),
        )
        yield space_id, sample.image.crop(box)


def summarize_scales(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {"samples": len(rows), "ssd_min_anchor_scale_px": 21}
    for row_name in ("all", "far", "near"):
        selected = rows if row_name == "all" else [r for r in rows if r["row"] == row_name]
        if not selected:
            continue
        result[row_name] = {
            "count": len(selected),
            "source_width_px_median": round(statistics.median(r["source_width_px"] for r in selected), 3),
            "source_height_px_median": round(statistics.median(r["source_height_px"] for r in selected), 3),
            "ssd_width_px_median": round(statistics.median(r["ssd_width_px"] for r in selected), 3),
            "ssd_height_px_median": round(statistics.median(r["ssd_height_px"] for r in selected), 3),
            "ssd_width_below_21_count": sum(r["ssd_width_px"] < 21 for r in selected),
            "area_percent_median": round(statistics.median(r["source_area_percent"] for r in selected), 5),
        }
    return result


def aggregate_image_metrics(metrics: list[dict[str, Any]]) -> dict[str, Any]:
    keys = (
        "luminance_mean", "luminance_std", "mean_saturation",
        "mean_edge_strength", "edge_density_gt_20",
    )
    return {
        key: {
            "mean": round(statistics.mean(row[key] for row in metrics), 5),
            "min": round(min(row[key] for row in metrics), 5),
            "max": round(max(row[key] for row in metrics), 5),
        }
        for key in keys
    }


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def run_ssd(
    samples: list[Sample], detector: NvidiaSSD, rois: dict[str, tuple[float, float, float, float]]
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    frames, all_vehicle_scores, latencies, class_confusion = [], [], [], Counter()
    for sample in samples:
        detections, latency = _nms_detailed(detector, sample.image)
        vehicles = [d for d in detections if d["label"] in VEHICLES]
        all_vehicle_scores.extend(d["confidence"] for d in vehicles)
        latencies.append(latency)
        occupied_top = {}
        for space_id in sample.occupied_spaces:
            roi = rois.get(space_id)
            candidates = [d for d in detections if roi and _box_intersection(d["box"], roi) > 0]
            top = max(candidates, key=lambda d: d["confidence"], default=None)
            vehicle_candidates = [d for d in candidates if d["label"] in VEHICLES]
            top_vehicle = max(
                vehicle_candidates, key=lambda d: d["confidence"], default=None
            )
            label = top["label"] if top else "none"
            class_confusion[label] += 1
            occupied_top[space_id] = {
                "top_raw_label": label,
                "top_raw_confidence": top["confidence"] if top else None,
                "top_vehicle_label": top_vehicle["label"] if top_vehicle else None,
                "top_vehicle_confidence": (
                    top_vehicle["confidence"] if top_vehicle else None
                ),
            }
        frames.append(
            {
                "frame_id": sample.frame_id,
                "seed": sample.seed,
                "preset": sample.preset,
                "occupied_spaces": len(sample.occupied_spaces),
                "total_detections_at_0.01": len(detections),
                "vehicle_detections_at_0.01": len(vehicles),
                "highest_vehicle_score": vehicles[0]["confidence"] if vehicles else None,
                "inference_ms": round(latency, 3),
                "image_width": sample.image.width,
                "image_height": sample.image.height,
                "top_detections": detections[:10],
                "top_class_per_occupied_roi": occupied_top,
            }
        )
    summary = {
        "frames": len(samples),
        "positive_frames": sum(bool(s.occupied_spaces) for s in samples),
        "total_detections_at_existing_0.01_floor": sum(f["total_detections_at_0.01"] for f in frames),
        "vehicle_detections_at_existing_0.01_floor": sum(f["vehicle_detections_at_0.01"] for f in frames),
        "frames_with_any_vehicle_detection": sum(bool(f["vehicle_detections_at_0.01"]) for f in frames),
        "frames_with_vehicle_at_or_above_0.65": sum((f["highest_vehicle_score"] or 0) >= 0.65 for f in frames),
        "highest_vehicle_score": max(all_vehicle_scores, default=None),
        "vehicle_confidence_histogram": histogram(all_vehicle_scores),
        "occupied_roi_top_class_confusion": dict(class_confusion.most_common()),
        "inference_ms": {
            "mean": round(statistics.mean(latencies), 3),
            "median": round(statistics.median(latencies), 3),
            "p95": round(sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1], 3),
        },
    }
    flat = [
        {k: v for k, v in frame.items() if k not in ("top_detections", "top_class_per_occupied_roi")}
        for frame in frames
    ]
    return summary, frames, flat


def correlate_scale_and_confidence(
    scale_rows: list[dict[str, Any]], frames: list[dict[str, Any]]
) -> dict[str, Any]:
    frame_map = {frame["frame_id"]: frame for frame in frames}
    joined = []
    for scale in scale_rows:
        frame = frame_map.get(scale["frame_id"])
        evidence = (
            frame.get("top_class_per_occupied_roi", {}).get(scale["space_id"])
            if frame
            else None
        )
        if evidence is None:
            continue
        joined.append(
            {
                **scale,
                "top_vehicle_confidence": evidence["top_vehicle_confidence"] or 0.0,
                "vehicle_candidate_present": evidence["top_vehicle_confidence"] is not None,
            }
        )
    widths = np.asarray([row["ssd_width_px"] for row in joined], dtype=np.float64)
    scores = np.asarray([row["top_vehicle_confidence"] for row in joined], dtype=np.float64)
    correlation = (
        float(np.corrcoef(widths, scores)[0, 1])
        if len(joined) > 1 and widths.std() and scores.std()
        else None
    )
    groups = {}
    for row_name in ("far", "near"):
        selected = [row for row in joined if row["row"] == row_name]
        groups[row_name] = {
            "objects": len(selected),
            "vehicle_candidate_present": sum(row["vehicle_candidate_present"] for row in selected),
            "maximum_vehicle_confidence": max(
                (row["top_vehicle_confidence"] for row in selected), default=0
            ),
            "median_vehicle_confidence_including_zero": (
                statistics.median(row["top_vehicle_confidence"] for row in selected)
                if selected
                else None
            ),
        }
    return {
        "method": "Pearson correlation of difference-derived SSD-width and top raw vehicle score within each occupied ROI; missing vehicle candidates score zero",
        "objects": len(joined),
        "pearson_ssd_width_vs_vehicle_confidence": correlation,
        "groups": groups,
    }


def run_controlled(
    samples: list[Sample], detector: NvidiaSSD, rois: dict[str, tuple[float, float, float, float]]
) -> dict[str, Any]:
    positive = [s for s in samples if s.occupied_spaces]
    variants: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sample in positive:
        for name, image in controlled_variants(sample.image).items():
            detections, latency = _nms_detailed(detector, image)
            vehicles = [d for d in detections if d["label"] in VEHICLES]
            variants[name].append(
                {
                    "frame_id": sample.frame_id,
                    "score": vehicles[0]["confidence"] if vehicles else None,
                    "label": vehicles[0]["label"] if vehicles else None,
                    "box": vehicles[0]["box"] if vehicles else None,
                    "inference_ms": round(latency, 3),
                }
            )
    crops = []
    for sample in positive:
        for space_id, image in local_crops(sample, rois):
            detections, latency = _nms_detailed(detector, image)
            vehicles = [d for d in detections if d["label"] in VEHICLES]
            crops.append(
                {
                    "frame_id": sample.frame_id,
                    "space_id": space_id,
                    "score": vehicles[0]["confidence"] if vehicles else None,
                    "label": vehicles[0]["label"] if vehicles else None,
                    "box": vehicles[0]["box"] if vehicles else None,
                    "inference_ms": round(latency, 3),
                }
            )
    return {
        "note": "Offline image copies only; A0 thresholds and production preprocessing are unchanged.",
        "variants": {
            name: {
                "frames": len(rows),
                "frames_with_vehicle": sum(row["score"] is not None for row in rows),
                "frames_at_or_above_0.65": sum((row["score"] or 0) >= 0.65 for row in rows),
                "maximum_vehicle_score": max((row["score"] or 0) for row in rows),
                "median_vehicle_score_when_present": (
                    statistics.median(row["score"] for row in rows if row["score"] is not None)
                    if any(row["score"] is not None for row in rows) else None
                ),
                "results": rows,
            }
            for name, rows in variants.items()
        },
        "object_local_crops": {
            "crops": len(crops),
            "crops_with_vehicle": sum(row["score"] is not None for row in crops),
            "crops_at_or_above_0.65": sum((row["score"] or 0) >= 0.65 for row in crops),
            "maximum_vehicle_score": max((row["score"] or 0) for row in crops),
            "results": crops,
        },
    }


def run_alternative(
    samples: list[Sample],
    name: str,
    rois: dict[str, tuple[float, float, float, float]],
    polygons: dict[str, Polygon],
) -> dict[str, Any]:
    import torch
    from torchvision.models.detection import (
        FasterRCNN_ResNet50_FPN_V2_Weights,
        SSDLite320_MobileNet_V3_Large_Weights,
        fasterrcnn_resnet50_fpn_v2,
        ssdlite320_mobilenet_v3_large,
    )

    if name == "fasterrcnn-resnet50-fpn-v2":
        weights = FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT
        model = fasterrcnn_resnet50_fpn_v2(weights=weights).eval()
    elif name == "ssdlite320-mobilenet-v3-large":
        weights = SSDLite320_MobileNet_V3_Large_Weights.DEFAULT
        model = ssdlite320_mobilenet_v3_large(weights=weights).eval()
    else:
        raise ValueError(f"unknown alternative model {name}")
    categories = weights.meta["categories"]
    rows, latencies = [], []
    occupied_total = occupied_matched = empty_total = empty_matched = 0
    occupied_qualified = empty_qualified = 0
    matched_scores = []
    for sample in samples:
        array = np.asarray(sample.image.convert("RGB"), dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array.transpose(2, 0, 1).copy())
        started = time.perf_counter()
        with torch.inference_mode():
            result = model([tensor])[0]
        latency = (time.perf_counter() - started) * 1000
        latencies.append(latency)
        detections = []
        for box, label, score in zip(result["boxes"], result["labels"], result["scores"], strict=True):
            confidence = float(score)
            if confidence < 0.05:
                continue
            class_name = categories[int(label)]
            detections.append(
                {
                    "label": class_name,
                    "confidence": confidence,
                    "box_pixels": [round(float(v), 3) for v in box.tolist()],
                }
            )
        vehicles = [d for d in detections if d["label"] in VEHICLES]
        normalized_vehicles = [
            {
                **d,
                "normalized_box": [
                    d["box_pixels"][0] / sample.image.width,
                    d["box_pixels"][1] / sample.image.height,
                    d["box_pixels"][2] / sample.image.width,
                    d["box_pixels"][3] / sample.image.height,
                ],
            }
            for d in vehicles
        ]
        occupied = set(sample.occupied_spaces)
        per_space = {}
        for space_id, roi in rois.items():
            candidates = [
                detection
                for detection in normalized_vehicles
                if _box_intersection(detection["normalized_box"], roi) > 0
            ]
            top = max(candidates, key=lambda d: d["confidence"], default=None)
            qualified = [
                detection
                for detection in normalized_vehicles
                if detection["confidence"] >= 0.65
                and polygons[space_id].intersection(
                    shapely_box(*detection["normalized_box"])
                ).area
                / polygons[space_id].area
                >= 0.45
            ]
            expected = space_id in occupied
            if expected:
                occupied_total += 1
                occupied_matched += top is not None
                occupied_qualified += bool(qualified)
                if top:
                    matched_scores.append(top["confidence"])
            else:
                empty_total += 1
                empty_matched += top is not None
                empty_qualified += bool(qualified)
            per_space[space_id] = {
                "expected_occupied": expected,
                "vehicle_overlap": top is not None,
                "passes_a0_confidence_and_coverage_gate": bool(qualified),
                "top_confidence": top["confidence"] if top else None,
                "top_label": top["label"] if top else None,
            }
        rows.append(
            {
                "frame_id": sample.frame_id,
                "occupied_spaces": len(sample.occupied_spaces),
                "detections_at_model_default_0.05": len(detections),
                "vehicle_detections": len(vehicles),
                "highest_vehicle_score": vehicles[0]["confidence"] if vehicles else None,
                "top_vehicle": vehicles[0] if vehicles else None,
                "space_overlap": per_space,
                "inference_ms": round(latency, 3),
            }
        )
    return {
        "model": name,
        "weights": str(weights),
        "runtime": "PyTorch/torchvision CPU; CUDA-compatible without application integration",
        "frames": len(samples),
        "positive_frames": sum(bool(s.occupied_spaces) for s in samples),
        "positive_frames_with_vehicle": sum(bool(r["vehicle_detections"]) for r in rows if r["occupied_spaces"]),
        "all_frames_with_vehicle": sum(bool(r["vehicle_detections"]) for r in rows),
        "highest_vehicle_score": max((r["highest_vehicle_score"] or 0) for r in rows),
        "space_overlap_proxy": {
            "note": "Any intersection with a calibrated ROI; not an IoU-qualified final occupancy metric.",
            "occupied_spaces": occupied_total,
            "occupied_spaces_with_vehicle_overlap": occupied_matched,
            "occupied_space_recall": occupied_matched / occupied_total if occupied_total else None,
            "empty_spaces": empty_total,
            "empty_spaces_with_vehicle_overlap": empty_matched,
            "empty_space_overlap_rate": empty_matched / empty_total if empty_total else None,
            "median_matched_confidence": statistics.median(matched_scores) if matched_scores else None,
        },
        "a0_gate_proxy": {
            "note": "Alternative-model boxes evaluated with A0 occupied confidence 0.65 and polygon coverage 0.45; diagnostic only.",
            "occupied_spaces": occupied_total,
            "occupied_spaces_passing_gate": occupied_qualified,
            "occupied_space_recall": occupied_qualified / occupied_total if occupied_total else None,
            "empty_spaces": empty_total,
            "empty_spaces_passing_gate": empty_qualified,
            "empty_space_false_occupied_rate": empty_qualified / empty_total if empty_total else None,
        },
        "inference_ms": {
            "mean": round(statistics.mean(latencies), 3),
            "median": round(statistics.median(latencies), 3),
            "p95": round(sorted(latencies)[math.ceil(0.95 * len(latencies)) - 1], 3),
        },
        "results": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--calibration", required=True, type=Path)
    parser.add_argument("--ssd-source", type=Path)
    parser.add_argument("--ssd-weights", type=Path)
    parser.add_argument("--real-control", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--alternative",
        action="append",
        choices=("fasterrcnn-resnet50-fpn-v2", "ssdlite320-mobilenet-v3-large"),
        default=[],
    )
    parser.add_argument("--skip-controlled", action="store_true")
    args = parser.parse_args()
    if not args.ssd_source or not args.ssd_weights:
        parser.error("--ssd-source and --ssd-weights are required")

    args.output.mkdir(parents=True, exist_ok=True)
    samples, schema = load_samples(args.input)
    rois = calibration_rois(args.calibration)
    polygons = calibration_polygons(args.calibration)
    detector = NvidiaSSD(args.ssd_source, args.ssd_weights)
    baseline, frames, frame_rows = run_ssd(samples, detector, rois)
    scales = estimate_object_scales(samples, rois)
    synthetic_metrics = [image_metrics(sample.image) for sample in samples]
    preprocessing = {
        "decoded_mode_observed": sorted({sample.image.mode for sample in samples}),
        "decoded_dimensions_observed": sorted({sample.image.size for sample in samples}),
        "jpeg_decoder": "Pillow Image.open; decoded image explicitly converted to RGB by research audit",
        "production_decode": "Pillow Image.open(...).convert('RGB') in A0 provider",
        "model_resize": "Pillow resize to 300x300, bilinear; full-frame stretch, no letterbox",
        "model_array": "HWC RGB numpy.float32",
        "normalization": "uint8 [0,255] /255 *2 -1 => float32 [-1,1]",
        "tensor_layout": "NCHW RGB",
        "alpha": "discarded by explicit RGB conversion",
        "exif": "Pillow decode only; no ImageOps.exif_transpose in production",
        "aspect_effect": "1280x720 becomes 300x300: y is magnified 1.7778x relative to x",
        "ssd_input": [300, 300],
        "ssd_feature_maps": [38, 19, 10, 5, 3, 1],
        "ssd_anchor_scales_px": [21, 45, 99, 153, 207, 261, 315],
    }
    report = {
        "schema": "parkright-a2-domain-gap-report-v1",
        "source_schema": schema,
        "source_path_supplied": str(args.input),
        "source_sha256": _sha256(args.input.read_bytes()),
        "model_identity": detector.identity,
        "baseline": baseline,
        "object_scale": summarize_scales(scales),
        "scale_confidence": correlate_scale_and_confidence(scales, frames),
        "preprocessing_audit": preprocessing,
        "synthetic_image_metrics": aggregate_image_metrics(synthetic_metrics),
    }
    if args.real_control:
        control = _decode_jpeg(args.real_control.read_bytes()).convert("RGB")
        detections, latency = _nms_detailed(detector, control)
        report["real_control"] = {
            "sha256": _sha256(args.real_control.read_bytes()),
            "image_metrics": image_metrics(control),
            "inference_ms": round(latency, 3),
            "top_detections": detections[:10],
            "top_vehicle": next((d for d in detections if d["label"] in VEHICLES), None),
        }
    (args.output / "baseline.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "frames.json").write_text(json.dumps(frames, indent=2) + "\n")
    _write_csv(args.output / "frames.csv", frame_rows)
    _write_csv(args.output / "object-scale.csv", scales)
    if not args.skip_controlled:
        controlled = run_controlled(samples, detector, rois)
        (args.output / "controlled.json").write_text(json.dumps(controlled, indent=2) + "\n")
    alternatives = [
        run_alternative(samples, name, rois, polygons) for name in args.alternative
    ]
    if alternatives:
        (args.output / "alternatives.json").write_text(json.dumps(alternatives, indent=2) + "\n")
    print(json.dumps(report["baseline"], indent=2))


if __name__ == "__main__":
    main()
