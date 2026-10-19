"""Draw calibration and model boxes on a separate diagnostic copy; never uploaded."""

import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw


def overlay(jpeg, calibration, target, detections=()):
    image = Image.open(jpeg).convert("RGB")
    draw = ImageDraw.Draw(image)
    w, h = image.size
    for name, polygon in calibration["polygons"].items():
        points = [(p["x"] * w, p["y"] * h) for p in polygon]
        draw.line(points + [points[0]], fill="cyan", width=3)
        draw.text(points[0], name, fill="white", stroke_width=1, stroke_fill="black")
    for d in detections:
        if d["label"] not in ("car", "truck", "bus") or d["confidence"] < 0.05:
            continue
        x1, y1, x2, y2 = d["box"]
        draw.rectangle((x1 * w, y1 * h, x2 * w, y2 * h), outline="yellow", width=2)
        draw.text(
            (x1 * w, y1 * h), f"{d['label']} {d['confidence']:.2f}", fill="yellow"
        )
    draw.text(
        (8, 8),
        "DEBUG COPY — CALIBRATION / DETECTIONS — NOT INFERENCE INPUT",
        fill="white",
        stroke_width=1,
        stroke_fill="black",
    )
    image.save(target)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("jpeg", type=Path)
    p.add_argument("calibration", type=Path)
    p.add_argument("output", type=Path)
    a = p.parse_args()
    overlay(a.jpeg, json.loads(a.calibration.read_text()), a.output)
