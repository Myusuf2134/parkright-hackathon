#!/usr/bin/env python3
"""Reproduce the independent A2 OPEN safety evaluation.

This script only reads the frozen TEST split, checkpoint, calibration, and captured
integration-demo artifacts. It never imports or mutates API state-machine code.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import platform
import statistics
import sys
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box as shapely_box

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "services/perception/src"))
sys.path.insert(0, str(REPO / "packages/contracts/src"))

from parkright_perception.a2.fasterrcnn import (  # noqa: E402
    CHECKPOINT_SHA256,
    FasterRCNNA2,
)
from policy import (  # noqa: E402
    AMBIGUITY_CONFIDENCE,
    AMBIGUITY_COVERAGE,
    OCCUPIED_CONFIDENCE,
    OCCUPIED_COVERAGE,
    SINGLE_FRAME_POLICIES,
    attach_single_frame_states,
    attach_temporal_state,
    breakdowns,
    metrics,
)


DATASET_VERSION = "a2-sim-v1-b569da957c"
DATASET_MANIFEST_SHA256 = "935f4108f4b1e00c17f71b090ac60f4ad38c86e1ec183b10bef121f2a4e976c3"
CALIBRATION_SHA256 = "50b7bcc93de01e2c9e501ee607d477396116644cf20d504951725f1273d3245d"
DEMO_SHA256 = {
    "manifest.json": "f0f3a71c31f3ab45bfb7892bc36d0399db1b3b7fe43e4ce7d3452dd4d23b5e17",
    "dataset.json": "341dcd646bfc6ca5106e3cb502980e011aba1da1a4f6fbc221f695065ecf252c",
    "rate-1.json": "3240610cfa5df98488ff574d1d1856af6b391dfdcc0feebcd267341307134639",
    "rate-2.json": "7f893214d0ec7f2f6898fa6d6c57ae51fe14e4b6ae711e2089bdd11daab0ad97",
    "rate-5.json": "d320a30740bc6856530c7d09545a6611d33688f39acbf094fb12ba8236be72f7",
}

QUALITY = {
    "min_dimension": 64,
    "max_pixels": 16_000_000,
    "min_roi_pixels": 256,
    "min_brightness": 18.0,
    "max_brightness": 240.0,
    "min_contrast": 5.0,
}

POLICY_DEFINITIONS = {
    "current": "OCCUPIED at confidence >=0.65 and ROI coverage >=0.45; otherwise UNCERTAIN; OPEN disabled.",
    "naive_absence": "OCCUPIED at production gates; otherwise OPEN when frame and ROI quality pass.",
    "low_floor_space_veto": "Naive policy plus abstain when any A2 detection has confidence >=0.05 and ROI coverage >=0.02.",
    "any_overlap_veto": "Naive policy plus abstain when any A2 detection at the 0.05 model floor intersects the ROI.",
    "whole_frame_clear": "Naive policy but OPEN only when A2 emits no detection anywhere in the valid frame.",
    "oracle_context_gate": "Low-floor veto plus TEST-only ground-truth gates excluding transitions and scenarios with occluders; not deployable.",
    "temporal_2": "Two adjacent low-floor-veto OPEN candidates in a genuine same-scene sequence.",
    "temporal_3": "Three adjacent low-floor-veto OPEN candidates in a genuine same-scene sequence.",
    "temporal_5": "Five adjacent low-floor-veto OPEN candidates in a genuine same-scene sequence.",
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_digest(path: Path, expected: str) -> None:
    actual = sha256_file(path)
    if actual != expected:
        raise ValueError(f"artifact digest mismatch: {path} ({actual})")


class DetectionCache:
    def __init__(self, path: Path, checkpoint_sha256: str):
        self.path = path
        self.checkpoint_sha256 = checkpoint_sha256
        self.values: dict[str, dict] = {}
        if path.is_file():
            payload = json.loads(path.read_text())
            if payload.get("checkpoint_sha256") == checkpoint_sha256:
                self.values = payload.get("images", {})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(
                {
                    "schema": "parkright-a2-open-prediction-cache-v1",
                    "checkpoint_sha256": self.checkpoint_sha256,
                    "images": self.values,
                },
                sort_keys=True,
            )
            + "\n"
        )


def infer_jpeg(detector: FasterRCNNA2, cache: DetectionCache, jpeg: bytes) -> tuple[Image.Image, dict]:
    image_sha = sha256_bytes(jpeg)
    with Image.open(io.BytesIO(jpeg)) as opened:
        if opened.format != "JPEG":
            raise ValueError("evaluation image is not JPEG")
        image = opened.convert("RGB")
    if image_sha not in cache.values:
        started = time.perf_counter()
        result = detector.detect(image)
        latency_ms = (time.perf_counter() - started) * 1000
        cache.values[image_sha] = {
            "latency_ms": latency_ms,
            "detections": [
                {
                    "label": item.label,
                    "score": item.confidence,
                    "box": list(item.box),
                }
                for item in result.detections
            ],
        }
    return image, cache.values[image_sha]


def quality(pixels: np.ndarray) -> bool:
    return bool(
        pixels.size >= QUALITY["min_roi_pixels"]
        and QUALITY["min_brightness"] <= pixels.mean() <= QUALITY["max_brightness"]
        and pixels.std() >= QUALITY["min_contrast"]
    )


def image_quality(image: Image.Image, polygons: dict[str, list[dict]]) -> tuple[bool, dict[str, bool]]:
    width, height = image.size
    gray = np.asarray(image.convert("L"))
    frame_valid = bool(
        min(width, height) >= QUALITY["min_dimension"]
        and width * height <= QUALITY["max_pixels"]
        and quality(gray)
    )
    roi_valid = {}
    for space_id, points in polygons.items():
        mask = Image.new("1", (width, height))
        ImageDraw.Draw(mask).polygon(
            [(point["x"] * (width - 1), point["y"] * (height - 1)) for point in points],
            fill=1,
        )
        roi_valid[space_id] = frame_valid and quality(gray[np.asarray(mask, dtype=bool)])
    return frame_valid, roi_valid


def build_rows(
    *,
    sample_id: str,
    scenario_id: str,
    environment: str,
    density: str,
    kind: str,
    family: str,
    has_scenario_occluder: bool,
    truth: dict[str, str],
    polygons: dict[str, list[dict]],
    image: Image.Image,
    prediction: dict,
    sequence_id: str | None = None,
    sequence_index: int | None = None,
    vehicle_classes: dict[str, str] | None = None,
    robustness_variant: str = "none",
    transition_type: str = "none",
) -> list[dict]:
    frame_valid, roi_valid = image_quality(image, polygons)
    detections = prediction["detections"]
    rows = []
    for space_id, points in polygons.items():
        polygon = Polygon([(point["x"], point["y"]) for point in points])
        overlaps = []
        for detection in detections:
            overlap = polygon.intersection(shapely_box(*detection["box"])).area / polygon.area
            if overlap > 0:
                overlaps.append(
                    {
                        "label": detection["label"],
                        "score": round(float(detection["score"]), 8),
                        "coverage": round(float(overlap), 8),
                    }
                )
        occupied = any(
            item["label"] in {"car", "truck", "bus", "suv", "van"}
            and item["score"] >= OCCUPIED_CONFIDENCE
            and item["coverage"] >= OCCUPIED_COVERAGE
            for item in overlaps
        )
        ambiguous = any(
            item["score"] >= AMBIGUITY_CONFIDENCE
            and item["coverage"] >= AMBIGUITY_COVERAGE
            for item in overlaps
        )
        any_overlap = any(item["score"] >= AMBIGUITY_CONFIDENCE for item in overlaps)
        rows.append(
            {
                "sample_id": sample_id,
                "scenario_id": scenario_id,
                "environment": environment,
                "density": density,
                "kind": kind,
                "family": family,
                "space_id": space_id,
                "row": "far" if space_id.startswith("A") else "near",
                "vehicle_class": (vehicle_classes or {}).get(space_id, "empty"),
                "robustness_variant": robustness_variant,
                "transition_type": transition_type,
                "truth": truth[space_id],
                "frame_valid": frame_valid,
                "roi_valid": roi_valid[space_id],
                "detector_complete": True,
                "occupied_evidence": occupied,
                "ambiguous_evidence": ambiguous,
                "any_overlap_evidence": any_overlap,
                "frame_has_detection": bool(detections),
                "has_scenario_occluder": has_scenario_occluder,
                "overlaps": overlaps,
                "sequence_id": sequence_id,
                "sequence_index": sequence_index,
            }
        )
    return rows


def evaluate_test(
    dataset_root: Path,
    detector: FasterRCNNA2,
    cache: DetectionCache,
    polygons: dict[str, list[dict]],
) -> tuple[list[dict], list[float], int]:
    manifest_path = dataset_root / "manifest.jsonl"
    require_digest(manifest_path, DATASET_MANIFEST_SHA256)
    records = [json.loads(line) for line in manifest_path.read_text().splitlines()]
    records = [record for record in records if record["split"] == "test"]
    rows, latencies = [], []
    uncached = 0
    for index, record in enumerate(records, 1):
        jpeg = (dataset_root / record["image"]["path"]).read_bytes()
        image_sha = sha256_bytes(jpeg)
        was_cached = image_sha in cache.values
        image, prediction = infer_jpeg(detector, cache, jpeg)
        if not was_cached:
            uncached += 1
            if uncached % 10 == 0:
                cache.save()
                print(f"inferred {uncached} uncached TEST/demo images", flush=True)
        latencies.append(prediction["latency_ms"])
        scenario = record["scenario_params"]
        transition = scenario.get("transition")
        sequence_id = None
        sequence_index = None
        if record["kind"] == "transition" and transition is not None:
            # The TEST split has two true temporal positions per lighting preset.
            # Environment variants are never treated as consecutive frames.
            sequence_id = f"test:{record['scenario_id']}:{record['environment']['preset_id']}"
            sequence_index = {0.35: 0, 0.7: 1}.get(float(transition["progress"]))
        rows.extend(
            build_rows(
                sample_id=record["sample_id"],
                scenario_id=record["scenario_id"],
                environment=record["environment"]["preset_id"],
                density=scenario["density"],
                kind=record["kind"],
                family=record["family"],
                has_scenario_occluder=bool(scenario.get("occluders")),
                truth={item["space_id"]: item["truth"] for item in record["spaces"]},
                polygons=polygons,
                image=image,
                prediction=prediction,
                sequence_id=sequence_id,
                sequence_index=sequence_index,
                vehicle_classes={
                    item["space_id"]: item["class"] for item in record["vehicles"]
                },
                robustness_variant=scenario.get("pattern") or record["family"],
                transition_type=(transition or {}).get("kind", "none"),
            )
        )
    return rows, latencies, len(records)


def load_demo_records(
    path: Path,
    detector: FasterRCNNA2,
    cache: DetectionCache,
    polygons: dict[str, list[dict]],
    scenario_names: dict[str, dict],
    *,
    temporal_stream: bool,
) -> tuple[list[dict], list[float]]:
    require_digest(path, DEMO_SHA256[path.name])
    payload = json.loads(path.read_text())
    rows, latencies = [], []
    for record in payload["records"]:
        jpeg = base64.b64decode(record["jpeg_base64"], validate=True)
        image, prediction = infer_jpeg(detector, cache, jpeg)
        latencies.append(prediction["latency_ms"])
        metadata = record["metadata"]
        scenario = record["scenario"]
        ground_truth = record["ground_truth"]
        manifest_entry = scenario_names.get(metadata["session_id"], {})
        category = manifest_entry.get("category", "rate_stream" if temporal_stream else "unknown")
        scenario_id = manifest_entry.get("id", metadata["session_id"])
        occupancy_count = len(scenario.get("occupancy", {}))
        density = str(occupancy_count)
        kind = "transition" if category == "transition" or temporal_stream else "settled"
        rows.extend(
            build_rows(
                sample_id=f"{path.stem}:{metadata['session_id']}:{metadata['seq']}",
                scenario_id=scenario_id,
                environment=ground_truth["environment_preset"],
                density=density,
                kind=kind,
                family=category,
                has_scenario_occluder=category == "occlusion",
                truth={item["space_id"]: item["truth"] for item in ground_truth["spaces"]},
                polygons=polygons,
                image=image,
                prediction=prediction,
                sequence_id=(f"demo:{path.name}:{metadata['session_id']}" if temporal_stream else None),
                sequence_index=(int(metadata["seq"]) if temporal_stream else None),
                robustness_variant=category,
                transition_type=("rate_stream" if temporal_stream else (
                    "arrival" if category == "transition" else "none"
                )),
            )
        )
    return rows, latencies


def apply_policies(rows: list[dict]) -> list[str]:
    attach_single_frame_states(rows)
    names = list(SINGLE_FRAME_POLICIES)
    for window in (2, 3, 5):
        names.append(attach_temporal_state(rows, window=window))
    return names


def summarize_rows(rows: list[dict], policies: list[str]) -> dict:
    return {
        "overall": {policy: metrics(rows, policy) for policy in policies},
        "breakdowns": breakdowns(rows, policies),
    }


def latency_summary(values: list[float]) -> dict:
    ordered = sorted(values)
    p95_index = max(0, int(0.95 * len(ordered) + 0.999999) - 1)
    return {
        "count": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "p95": ordered[p95_index],
        "device": "cpu",
        "note": "Cached duplicate frames retain the latency of their first inference.",
    }


def compact_scene_results(rows: list[dict], policies: list[str]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["sample_id"]].append(row)
    return [
        {
            "sample_id": sample_id,
            "scenario_id": group[0]["scenario_id"],
            "environment": group[0]["environment"],
            "density": group[0]["density"],
            "family": group[0]["family"],
            "states": {
                policy: {
                    state: sum(row["states"][policy] == state for row in group)
                    for state in ("OCCUPIED", "OPEN", "UNCERTAIN")
                }
                for policy in policies
            },
        }
        for sample_id, group in sorted(groups.items())
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path.home() / ".cache/parkright/datasets" / DATASET_VERSION,
    )
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path.home() / ".cache/parkright/models/a2-fasterrcnn/best.pt",
    )
    parser.add_argument(
        "--demo-root",
        type=Path,
        default=Path.home()
        / "Desktop/parkright-worktrees/integration-a2-nemotron-demo/experiments/vertical-slice/runs/a2-evaluation",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path("/private/tmp/parkright-a2-open-evaluation-predictions.json"),
    )
    parser.add_argument("--output", type=Path, default=HERE / "RESULTS.json")
    args = parser.parse_args()

    require_digest(args.checkpoint, CHECKPOINT_SHA256)
    calibration_path = args.dataset_root / "calibration/cam-01.json"
    require_digest(calibration_path, CALIBRATION_SHA256)
    calibration = json.loads(calibration_path.read_text())
    if calibration["version"] != "cam-01-fixed-v1" or calibration["unobservable"]:
        raise ValueError("unexpected calibration")
    polygons = calibration["polygons"]

    detector = FasterRCNNA2(args.checkpoint, device="cpu")
    cache = DetectionCache(args.cache, CHECKPOINT_SHA256)
    test_rows, test_latencies, test_images = evaluate_test(
        args.dataset_root, detector, cache, polygons
    )
    cache.save()

    demo_manifest_path = args.demo_root / "manifest.json"
    require_digest(demo_manifest_path, DEMO_SHA256["manifest.json"])
    demo_manifest = json.loads(demo_manifest_path.read_text())
    scenario_names = {item["session_id"]: item for item in demo_manifest["scenarios"]}
    demo_rows, demo_latencies = load_demo_records(
        args.demo_root / "dataset.json",
        detector,
        cache,
        polygons,
        scenario_names,
        temporal_stream=False,
    )
    rate_outputs = {}
    rate_latencies = []
    for name in ("rate-1.json", "rate-2.json", "rate-5.json"):
        rate_rows, latencies = load_demo_records(
            args.demo_root / name,
            detector,
            cache,
            polygons,
            scenario_names,
            temporal_stream=True,
        )
        rate_latencies.extend(latencies)
        rate_policies = apply_policies(rate_rows)
        rate_outputs[name] = {
            "frames": len(rate_rows) // len(polygons),
            "summary": summarize_rows(rate_rows, rate_policies)["overall"],
        }
    cache.save()

    policies = apply_policies(test_rows)
    apply_policies(demo_rows)
    standard = [row for row in test_rows if row["family"] not in {
        "robust_pillar", "robust_large_vehicles", "robust_row_pattern"
    }]
    robustness = [row for row in test_rows if row["family"].startswith("robust_")]
    result = {
        "schema": "parkright-a2-open-evaluation-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "decision": "INSUFFICIENT_EVIDENCE",
        "base_commit": "a696787",
        "production_changed": False,
        "artifacts": {
            "dataset_version": DATASET_VERSION,
            "dataset_manifest_sha256": DATASET_MANIFEST_SHA256,
            "checkpoint_sha256": CHECKPOINT_SHA256,
            "calibration_version": calibration["version"],
            "calibration_sha256": CALIBRATION_SHA256,
            "demo_sha256": DEMO_SHA256,
        },
        "thresholds": {
            "occupied_confidence": OCCUPIED_CONFIDENCE,
            "occupied_coverage": OCCUPIED_COVERAGE,
            "ambiguity_confidence": AMBIGUITY_CONFIDENCE,
            "ambiguity_coverage": AMBIGUITY_COVERAGE,
            "quality": QUALITY,
        },
        "policy_definitions": POLICY_DEFINITIONS,
        "dataset": {
            "test_images": test_images,
            "test_space_observations": len(test_rows),
            "standard_images": len({row["sample_id"] for row in standard}),
            "standard_space_observations": len(standard),
            "robustness_images": len({row["sample_id"] for row in robustness}),
            "robustness_space_observations": len(robustness),
        },
        "test": summarize_rows(test_rows, policies),
        "test_standard": summarize_rows(standard, policies)["overall"],
        "test_robustness": summarize_rows(robustness, policies)["overall"],
        "demo_scenes": {
            "frames": len(demo_rows) // len(polygons),
            **summarize_rows(demo_rows, policies),
            "per_scene": compact_scene_results(demo_rows, policies),
        },
        "demo_rate_streams": rate_outputs,
        "latency_ms": {
            "test": latency_summary(test_latencies),
            "demo_scenes": latency_summary(demo_latencies),
            "demo_rate_streams": latency_summary(rate_latencies),
        },
        "evidence_limits": {
            "space_visibility": "A2 produces vehicle boxes only; it has no independent visible-empty-space evidence.",
            "occlusion_risk": "A2 produces no occlusion estimate. oracle_context_gate uses forbidden TEST scenario metadata only as an upper-bound diagnostic.",
            "transition_state": "A2 produces no transition state. The TEST split has only two same-lighting transition positions and no settled temporal sequences.",
            "temporal_3_and_5_test": "Not estimable for OPEN recall on frozen TEST: no TEST sequence contains 3 or 5 genuine consecutive frames.",
            "rate_streams": "Captured rate streams contain repeated frames at one simulator time; they test deterministic persistence, not changing-scene safety.",
        },
        "smallest_next_engineering_change": (
            "Add and validate camera-specific positive empty-space/visibility evidence "
            "(including an occlusion/transition gate), then collect a new sealed multi-frame "
            "held-out set with at least five consecutive frames per settled and transition scene."
        ),
        "runtime": {
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
    }
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "decision": result["decision"],
                "dataset": result["dataset"],
                "false_open": {
                    policy: result["test"]["overall"][policy]["false_open"]
                    for policy in policies
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
