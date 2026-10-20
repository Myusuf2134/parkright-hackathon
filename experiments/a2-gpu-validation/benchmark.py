"""Offline frozen A2 device validation; never trains or serves production traffic."""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import platform
import queue
import statistics
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "a2-finetune"))
from a2_finetune.config import load_config
from a2_finetune.dataset import load_label, load_records, sha256_file
from a2_finetune.metrics import box_iou, parking_metrics, precision_recall

CHECKPOINT = "43452092f0597922badc038c618dd5c76afc27d98be21688a2878f28b1c24985"
MANIFEST = "935f4108f4b1e00c17f71b090ac60f4ad38c86e1ec183b10bef121f2a4e976c3"
CONFIG = "7f3d63254ecc7d05bdec610c85c8dde7508e07f41e3d4b76cdae2d27769559b8"


def stats(values):
    ordered = sorted(values)
    if not ordered:
        return {"count": 0}
    return {"count": len(values), "mean": statistics.fmean(values),
            "median": statistics.median(values),
            **{f"p{p}": ordered[math.ceil(p / 100 * len(values)) - 1] for p in (95, 99)}}


def subset(records):
    """Two lexicographically first IDs per metadata stratum, independent of outcomes."""
    groups = defaultdict(list)
    for record in records:
        groups[(record.environment, record.subset, record.family, record.kind)].append(record)
    return [r for key in sorted(groups) for r in sorted(groups[key], key=lambda r: r.sample_id)[:2]]


def compare(cpu, gpu):
    unmatched = 0
    score_delta, box_delta, crossings = [], [], 0
    for key, a in cpu.items():
        b = gpu[key]
        remaining = set(range(len(b["boxes"])))
        for box, label, score in zip(a["boxes"], a["labels"], a["scores"], strict=True):
            candidates = [j for j in remaining if b["labels"][j] == label]
            j = max(candidates, key=lambda j: box_iou(box, b["boxes"][j]), default=None)
            if j is None or box_iou(box, b["boxes"][j]) < 0.99:
                unmatched += 1
                continue
            remaining.remove(j)
            score_delta.append(abs(score - b["scores"][j]))
            box_delta.append(max(abs(x-y) for x, y in zip(box, b["boxes"][j], strict=True)))
            crossings += int((score >= .65) != (b["scores"][j] >= .65))
        unmatched += len(remaining)
    return {"unmatched_detections_at_iou_099": unmatched, "confidence_gate_crossings": crossings,
            "max_score_delta": max(score_delta, default=0), "max_box_pixel_delta": max(box_delta, default=0)}


def sustained(infer, records, fps, seconds):
    """Bounded one-waiting-frame queue, drop newest on full; drain at end."""
    pending = queue.Queue(maxsize=1)
    done = threading.Event()
    counts = {"attempted": math.floor(fps * seconds), "accepted": 0, "dropped": 0, "scheduler_skipped": 0}
    rows = []
    started = time.perf_counter()

    def producer():
        try:
            for index in range(counts["attempted"]):
                due = started + index / fps
                time.sleep(max(0, due - time.perf_counter()))
                if time.perf_counter() - due >= 1 / fps:
                    counts["scheduler_skipped"] += 1
                    continue
                try:
                    pending.put_nowait((due, records[index % len(records)]))
                    counts["accepted"] += 1
                except queue.Full:
                    counts["dropped"] += 1
        finally:
            done.set()

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()
    while not done.is_set() or not pending.empty():
        try:
            due, record = pending.get(timeout=.05)
        except queue.Empty:
            continue
        begin = time.perf_counter()
        infer(record)
        end = time.perf_counter()
        rows.append({"queue_ms": (begin-due)*1000, "end_to_end_ms": (end-due)*1000,
                     "service_ms": (end-begin)*1000, "completed_at_seconds": end-started})
    thread.join()
    elapsed = max(seconds, time.perf_counter()-started)
    quarter = max(1, len(rows)//4)
    latencies = [r["end_to_end_ms"] for r in rows]
    return {**counts, "fps_attempted": fps, "duration_seconds": seconds, "completed": len(rows),
            "completed_within_window": sum(r["completed_at_seconds"] <= seconds for r in rows),
            "throughput_including_drain_fps": len(rows)/elapsed, "drain_seconds": elapsed-seconds,
            "queue_delay_ms": stats([r["queue_ms"] for r in rows]), "end_to_end_ms": stats(latencies),
            "deadline_misses": sum(x > 1000/fps for x in latencies),
            "last_minus_first_quartile_mean_ms": statistics.fmean(latencies[-quarter:])-statistics.fmean(latencies[:quarter]) if latencies else None,
            "sustainable": bool(latencies) and not counts["dropped"] and not counts["scheduler_skipped"] and max(latencies) <= 1000/fps,
            "frames": rows}


def verify(checkpoint, manifest, frozen, config):
    for path, expected in ((checkpoint, CHECKPOINT), (manifest, MANIFEST)):
        if sha256_file(path) != expected:
            raise ValueError(f"Frozen artifact checksum mismatch: {path.name}")
    metadata = json.loads(frozen.read_text())
    if config.sha256() != CONFIG or metadata.get("config_sha256") != CONFIG:
        raise ValueError("Frozen configuration mismatch")
    if metadata.get("checkpoint_sha256") != CHECKPOINT or metadata.get("dataset_manifest_sha256") != MANIFEST:
        raise ValueError("Frozen provenance mismatch")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, default=Path("/model"))
    parser.add_argument("--dataset", type=Path, default=Path("/dataset"))
    parser.add_argument("--output", type=Path, default=Path("/output"))
    parser.add_argument("--seconds", type=int, default=60)
    args = parser.parse_args()
    if args.seconds < 10:
        parser.error("each sustained trial must run for at least 10 seconds")
    if (args.output / "results.json").exists():
        parser.error("results already exist; retain the prior run, do not overwrite")
    import torch
    import torchvision
    import psutil
    from PIL import Image, ImageOps
    from torchvision.transforms.functional import pil_to_tensor
    from torchvision.models.detection import fasterrcnn_resnet50_fpn_v2
    from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

    if not torch.cuda.is_available():
        raise RuntimeError("No NVIDIA CUDA GPU available; no CPU fallback or provisioning")
    if torch.__version__.split("+")[0] != "2.14.1" or torchvision.__version__.split("+")[0] != "0.29.1":
        raise RuntimeError("Use frozen torch 2.14.1 / torchvision 0.29.1")
    torch.set_num_threads(4)
    torch.manual_seed(20261019)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    config = load_config(Path(__file__).resolve().parents[1] / "a2-finetune/config.json")
    checkpoint, frozen = args.model_dir / "best.pt", args.model_dir / "frozen.json"
    manifest = args.dataset / "manifest.jsonl"
    verify(checkpoint, manifest, frozen, config)
    validation = load_records(manifest, "validation")
    selected = subset(load_records(manifest, "test", test_unlock=frozen))
    args.output.mkdir(parents=True, exist_ok=True)
    runtime = {"machine": platform.platform(), "python": platform.python_version(),
               "torch": torch.__version__, "torchvision": torchvision.__version__, "cuda": torch.version.cuda,
               "gpu": torch.cuda.get_device_name(0), "batch_size": 1, "cpu_threads": 4,
               "checkpoint_sha256": CHECKPOINT, "manifest_sha256": MANIFEST, "config_sha256": CONFIG,
               "dataset_version": "a2-sim-v1-b569da957c", "precision": "FP32; TF32 disabled",
               "pip_freeze": subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True)}
    telemetry, telemetry_errors = [], []
    stop = threading.Event()

    def sample():
        while not stop.is_set():
            row = {"time": time.time(), "process_rss_bytes": psutil.Process().memory_info().rss}
            try:
                row["nvidia_smi"] = subprocess.check_output([
                    "nvidia-smi", "--query-gpu=uuid,name,driver_version,memory.used,memory.total,utilization.gpu",
                    "--format=csv,noheader,nounits"], text=True, timeout=3).strip()
            except (OSError, subprocess.SubprocessError) as exc:
                telemetry_errors.append(str(exc))
            telemetry.append(row)
            stop.wait(.5)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    try:
        load_start = time.perf_counter()
        model = fasterrcnn_resnet50_fpn_v2(weights=None, weights_backbone=None,
                                          min_size=config.min_size, max_size=config.max_size)
        model.roi_heads.box_predictor = FastRCNNPredictor(model.roi_heads.box_predictor.cls_score.in_features, 3)
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        model.load_state_dict(state["model"], strict=True)
        del state
        model.eval().cuda()
        torch.cuda.synchronize()
        load_seconds = time.perf_counter()-load_start

        def infer(record, device="cuda"):
            with Image.open(record.image_path) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
            tensor = pil_to_tensor(image).float().div(255)
            if device == "cuda":
                torch.cuda.synchronize()
            start = time.perf_counter()
            with torch.inference_mode():
                output = model([tensor.to(device)])[0]
            plain = {k: output[k].detach().cpu().tolist() for k in ("boxes", "labels", "scores")}
            if device == "cuda":
                torch.cuda.synchronize()
            return plain, (time.perf_counter()-start)*1000

        warm = time.perf_counter()
        for record in validation[:10]:
            infer(record)
        warm_seconds = time.perf_counter()-warm
        torch.cuda.reset_peak_memory_stats()
        times = [infer(validation[i % len(validation)])[1] for i in range(100)]
        trials = [sustained(infer, validation, fps, args.seconds) for fps in (1, 2, 5)]
        memory = {"peak_allocated_bytes": torch.cuda.max_memory_allocated(),
                  "peak_reserved_bytes": torch.cuda.max_memory_reserved()}
        predictions, summaries, park_rows, device_times = {}, {}, {}, {}
        truths = {r.sample_id: load_label(r, config.mapping()) for r in selected}
        for device in ("cuda", "cpu"):
            model.to(device)
            for record in validation[:10]:
                infer(record, device)
            outputs = [infer(r, device) for r in selected]
            pred = {r.sample_id: output[0] for r, output in zip(selected, outputs, strict=True)}
            predictions[device] = pred
            device_times[device] = stats([output[1] for output in outputs])
            parking = parking_metrics([(r, truths[r.sample_id], pred[r.sample_id]) for r in selected],
                                      confidence=.65, occupied_coverage=.45,
                                      ambiguity_confidence=.05, ambiguity_coverage=.02)
            park_rows[device] = parking.pop("rows")
            summaries[device] = {"detector": precision_recall(pred, truths, confidence=.65), "parking": parking}
        differences = compare(predictions["cpu"], predictions["cuda"])
        differences["parking_state_disagreements"] = sum(a["state"] != b["state"] for a,b in zip(park_rows["cpu"], park_rows["cuda"], strict=True))
        differences["review_required"] = bool(differences["unmatched_detections_at_iou_099"] or differences["confidence_gate_crossings"] or differences["parking_state_disagreements"] or differences["max_score_delta"] > .001 or differences["max_box_pixel_delta"] > 1)
        report = {"status": "measured", "runtime": runtime, "cold_process_load_seconds": load_seconds,
                  "warmup_seconds_10_frames": warm_seconds, "latency_ms": stats(times), "sustained": trials,
                  "gpu_memory": memory, "sanity_sample_ids": [r.sample_id for r in selected],
                  "sanity_metrics": summaries, "device_comparison_latency_ms": device_times,
                  "prediction_differences": differences}
        (args.output / "predictions.json").write_text(json.dumps(predictions))
    finally:
        stop.set()
        sampler.join(timeout=5)
        (args.output / "telemetry.json").write_text(json.dumps({"samples": telemetry, "errors": telemetry_errors}))
    report["telemetry_errors"] = telemetry_errors
    report["peak_process_rss_bytes"] = max((r["process_rss_bytes"] for r in telemetry), default=None)
    (args.output / "results.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"status": report["status"], "latency_ms": report["latency_ms"], "differences": differences}, indent=2))


if __name__ == "__main__":
    main()
