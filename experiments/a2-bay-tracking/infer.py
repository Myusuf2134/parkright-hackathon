#!/usr/bin/env python3
"""Run the frozen production A2 detector over one split of temporal v2 and cache raw detections.

    python experiments/a2-bay-tracking/infer.py --split dev
    python experiments/a2-bay-tracking/infer.py --split test      # only after FROZEN_POLICY.json is committed

TEST is sealed: refused unless FROZEN_POLICY.json exists and every artifact it binds (code,
dataset, checkpoint, references, DEV caches) is unchanged (seal.py). Only pixels go to the
detector; labels are never read here. Detector-dropout frames are applied later, by the
evaluation harness, identically for DEV and TEST.
"""

import argparse
import hashlib
import io
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from seal import DATASET, FROZEN, RUNS, require_frozen, sha256_file  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--split", choices=("dev", "test"), required=True)
    a = p.parse_args()
    from parkright_perception.a2.provider import DEFAULT_CHECKPOINT

    manifest = DATASET / "manifest.jsonl"
    if a.split == "test":
        require_frozen(FROZEN, DATASET, RUNS, DEFAULT_CHECKPOINT)

    from PIL import Image
    from parkright_perception.a2.fasterrcnn import FasterRCNNA2

    detector = FasterRCNNA2(DEFAULT_CHECKPOINT)  # verifies the checkpoint SHA-256
    records = [r for r in map(json.loads, manifest.open()) if r["split"] == a.split]
    RUNS.mkdir(parents=True, exist_ok=True)
    target = RUNS / f"detections-{a.split}.jsonl"
    done = {json.loads(line)["sample_id"] for line in target.open()} if target.exists() else set()
    started = time.perf_counter()
    with target.open("a") as out:
        for i, r in enumerate(records):
            if r["sample_id"] in done:
                continue
            data = (DATASET / r["image"]["path"]).read_bytes()
            row = {"sample_id": r["sample_id"], "image_sha256": hashlib.sha256(data).hexdigest(), "detector": detector.identity}
            t = time.perf_counter()
            try:
                with Image.open(io.BytesIO(data)) as image:
                    result = detector.detect(image.convert("RGB"))
                row["detections"] = [{"label": d.label, "confidence": d.confidence, "box": list(d.box)} for d in result.detections]
                row["error"] = None
            except Exception as exc:  # recorded, and blocks readiness downstream
                row["detections"], row["error"] = [], type(exc).__name__
            row["latency_ms"] = round((time.perf_counter() - t) * 1000, 1)
            out.write(json.dumps(row) + "\n")
            out.flush()
            if (i + 1) % 50 == 0:
                print(f"{a.split}: {i + 1}/{len(records)} ({(time.perf_counter() - started) / (i + 1 - len(done) or 1):.2f} s/frame)", flush=True)
    print(json.dumps({"split": a.split, "frames": len(records), "manifest_sha256": sha256_file(manifest), "output": str(target)}))


if __name__ == "__main__":
    main()
