from __future__ import annotations

import json
import platform
import statistics
import time
from collections import defaultdict
from pathlib import Path

from .config import ExperimentConfig
from .dataset import SampleRecord, load_label
from .metrics import detector_metrics, parking_metrics


def _plain(output) -> dict[str, list]:
    return {
        "boxes": output["boxes"].detach().cpu().tolist(),
        "labels": output["labels"].detach().cpu().tolist(),
        "scores": output["scores"].detach().cpu().tolist(),
    }


def infer(model, records: list[SampleRecord], config: ExperimentConfig, device: str = "cpu"):
    import torch
    from PIL import Image, ImageOps
    from torchvision.transforms.functional import pil_to_tensor

    model.eval().to(device)
    predictions, truths, enriched, latencies = {}, {}, [], []
    with torch.inference_mode():
        for record in records:
            label = load_label(record, config.mapping())
            with Image.open(record.image_path) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
            tensor = pil_to_tensor(image).float().div(255).to(device)
            started = time.perf_counter()
            output = model([tensor])[0]
            latency = (time.perf_counter() - started) * 1000
            prediction = _plain(output)
            truth = {"boxes": label["boxes"], "labels": label["labels"]}
            predictions[record.sample_id] = prediction
            truths[record.sample_id] = truth
            enriched.append((record, label, prediction))
            latencies.append(latency)
    return predictions, truths, enriched, latencies


def _summary_for(records, predictions, truths, enriched, config):
    ids = {record.sample_id for record in records}
    selected_predictions = {key: value for key, value in predictions.items() if key in ids}
    selected_truths = {key: value for key, value in truths.items() if key in ids}
    selected_enriched = [item for item in enriched if item[0].sample_id in ids]
    detector = detector_metrics(selected_predictions, selected_truths, config.evaluation_confidence)
    parking = parking_metrics(
        selected_enriched,
        confidence=config.evaluation_confidence,
        occupied_coverage=config.occupied_coverage,
        ambiguity_confidence=config.ambiguity_confidence,
        ambiguity_coverage=config.ambiguity_coverage,
    )
    parking.pop("rows")
    return {"images": len(records), "detector": detector, "parking": parking}


def summarize(records, predictions, truths, enriched, latencies, config: ExperimentConfig) -> dict:
    breakdowns = {}
    selectors = {
        "environment": lambda r: r.environment,
        "subset": lambda r: r.subset,
        "kind": lambda r: r.kind,
        "family": lambda r: r.family,
    }
    for dimension, selector in selectors.items():
        groups = defaultdict(list)
        for record in records:
            groups[selector(record)].append(record)
        breakdowns[dimension] = {
            key: _summary_for(group, predictions, truths, enriched, config)
            for key, group in sorted(groups.items())
        }
    ordered = sorted(latencies)
    p95_index = max(0, int(0.95 * len(ordered) + 0.999999) - 1)
    return {
        "schema": "parkright-a2-evaluation-v1",
        "overall": _summary_for(records, predictions, truths, enriched, config),
        "breakdowns": breakdowns,
        "latency_ms": {
            "count": len(latencies),
            "mean": statistics.fmean(latencies),
            "median": statistics.median(latencies),
            "p95": ordered[p95_index],
            "device": "cpu",
            "batch_size": 1,
            "model_min_size": config.min_size,
            "model_max_size": config.max_size,
            "machine": platform.platform(),
        },
    }


def evaluate(model, records: list[SampleRecord], config: ExperimentConfig, device: str = "cpu") -> dict:
    predictions, truths, enriched, latencies = infer(model, records, config, device)
    return summarize(records, predictions, truths, enriched, latencies, config)


def write_summary(summary: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

