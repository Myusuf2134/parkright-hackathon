"""Render a small OFFLINE DATASET QA set: label overlays drawn on COPIES of source images.

    uv run --frozen --all-packages --all-extras python experiments/a2-dataset/qa.py <dataset> [--count 24]

Writes qa/QA-<sample_id>.png (PNG, so it cannot be mistaken for a source JPEG) with a
banner reading OFFLINE DATASET QA. Source images are only read, never modified. These
files are debugging artifacts and must not be sent to production perception.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_label, load_manifest  # noqa: E402

BANNER = "OFFLINE DATASET QA - NOT A PERCEPTION INPUT"


def pick(manifest: list[dict], count: int) -> list[dict]:
    """Deterministic, representative: round-robin over (family, environment) cells."""
    cells: dict[tuple, list[dict]] = {}
    for r in manifest:
        cells.setdefault((r["family"], r["environment"]["preset_id"]), []).append(r)
    order = sorted(cells)
    chosen, i = [], 0
    while len(chosen) < count and any(cells.values()):
        cell = cells[order[i % len(order)]]
        if cell:
            chosen.append(cell.pop(len(cell) // 2))
        i += 1
    return chosen


def overlay(root: Path, record: dict) -> Image.Image:
    lab = load_label(root, record)
    with Image.open(root / record["image"]["path"]) as src:
        im = src.convert("RGB")
    d = ImageDraw.Draw(im)
    for s in lab["spaces"]:
        colour = (230, 60, 60) if s["truth"] == "occupied" else (60, 220, 90)
        d.polygon([tuple(p) for p in s["polygon_px"]], outline=colour, width=3)
        x, y = s["polygon_px"][0]
        d.text((x + 4, y + 2), f"{s['space_id']} {s['truth'].upper()}", fill=colour)
    for o in lab["objects"]:
        if o["bbox_amodal"]:
            d.rectangle(o["bbox_amodal"], outline=(255, 140, 0), width=2)
            d.text((o["bbox_amodal"][0] + 2, o["bbox_amodal"][3] - 12), f"occluder:{o['kind']}", fill=(255, 140, 0))
    for v in lab["vehicles"]:
        if v["bbox_amodal"]:
            d.rectangle(v["bbox_amodal"], outline=(0, 200, 255), width=1)
        if v["bbox_visible"]:
            d.rectangle(v["bbox_visible"], outline=(255, 230, 0), width=2)
            x0, y0 = v["bbox_visible"][:2]
            d.text((x0 + 2, y0 - 12), f"{v['instance_id']} {v['class']} vis {v['visible_fraction']:.2f}", fill=(255, 230, 0))
    d.rectangle((0, 0, im.width, 26), fill=(0, 0, 0))
    d.text((8, 7), f"{BANNER} · {record['sample_id']} · {record['split']}/{record['subset']} · {record['family']}", fill=(255, 255, 255))
    d.text((8, im.height - 16), "yellow: visible box · cyan: amodal box · orange: occluder · red/green: space truth", fill=(255, 255, 255))
    return im


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--count", type=int, default=24)
    args = parser.parse_args()
    root = args.dataset
    out = root / "qa"
    out.mkdir(exist_ok=True)
    chosen = pick(load_manifest(root), args.count)
    for r in chosen:
        overlay(root, r).save(out / f"QA-{r['sample_id']}.png")
    thumbs = [Image.open(out / f"QA-{r['sample_id']}.png").resize((427, 240)) for r in chosen]
    cols = 4
    sheet = Image.new("RGB", (cols * 427, ((len(thumbs) + cols - 1) // cols) * 240))
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % cols) * 427, (i // cols) * 240))
    sheet.save(out / "QA-contact-sheet.png")
    (out / "index.json").write_text(json.dumps({"notice": BANNER, "samples": [r["sample_id"] for r in chosen]}, indent=2) + "\n")
    print(f"{len(chosen)} QA overlays + contact sheet → {out}")


if __name__ == "__main__":
    main()
