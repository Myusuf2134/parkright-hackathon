#!/usr/bin/env python3
"""Run the frozen production A2 detector over one split of the temporal dataset and cache raw detections.

    python experiments/a2-open-evidence/infer.py --split dev
    python experiments/a2-open-evidence/infer.py --split test --frozen experiments/a2-open-evidence/FROZEN_RULE.json

TEST is sealed: it is refused unless a frozen rule file matches this dataset's manifest
(see seal.py). Only pixels go to the detector; labels are never read here.
"""

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from seal import DATASET, RUNS, require_frozen, sha256_file  # noqa: E402


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset", type=Path, default=DATASET)
    p.add_argument("--split", choices=("dev", "test"), required=True)
    p.add_argument("--frozen", type=Path)
    p.add_argument("--out", type=Path, default=RUNS)
    a = p.parse_args()
    manifest = a.dataset / "manifest.jsonl"
    if a.split == "test":
        require_frozen(a.frozen, manifest)

    from PIL import Image
    from parkright_perception.a2.fasterrcnn import FasterRCNNA2
    from parkright_perception.a2.provider import DEFAULT_CHECKPOINT

    detector = FasterRCNNA2(DEFAULT_CHECKPOINT)  # verifies the checkpoint SHA-256
    records = [r for r in map(json.loads, manifest.open()) if r["split"] == a.split]
    a.out.mkdir(parents=True, exist_ok=True)
    target = a.out / f"detections-{a.split}.jsonl"
    done = {json.loads(line)["sample_id"] for line in target.open()} if target.exists() else set()
    started = time.perf_counter()
    with target.open("a") as out:
        for i, r in enumerate(records):
            if r["sample_id"] in done:
                continue
            data = (a.dataset / r["image"]["path"]).read_bytes()
            import io

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
