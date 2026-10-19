"""Diagnostic scale probe: same NVIDIA model on ALL static ROI crops, no labels."""

import argparse
import json
import os
from dataclasses import asdict
from pathlib import Path
from PIL import Image
from parkright_perception.a0.nvidia_ssd import NvidiaSSD


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jpeg", type=Path)
    parser.add_argument(
        "--calibration",
        type=Path,
        default=Path("packages/shared/calibration/cam-01.json"),
    )
    args = parser.parse_args()
    image = Image.open(args.jpeg).convert("RGB")
    w, h = image.size
    calibration = json.loads(args.calibration.read_text())
    detector = NvidiaSSD(
        Path(os.environ["PARKRIGHT_A0_SOURCE"]),
        Path(os.environ["PARKRIGHT_A0_WEIGHTS"]),
    )
    results = []
    for name, points in calibration["polygons"].items():
        xs = [p["x"] for p in points]
        ys = [p["y"] for p in points]
        bounds = (
            max(0, int((min(xs) - 0.03) * w)),
            max(0, int((min(ys) - 0.10) * h)),
            min(w, int((max(xs) + 0.03) * w)),
            min(h, int((max(ys) + 0.02) * h)),
        )
        result = detector.detect(image.crop(bounds))
        results.append(
            {
                "space_id": name,
                "crop_xyxy_pixels": bounds,
                "vehicle_detections": [
                    asdict(d)
                    for d in result.detections
                    if d.label in ("car", "truck", "bus") and d.confidence >= 0.05
                ],
            }
        )
    print(
        json.dumps(
            {
                "mode": "REAL NVIDIA diagnostic crops; not production predictions",
                "identity": detector.identity,
                "crops": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
