"""Derive COCO detection files FROM the canonical manifest + labels (never the reverse).

    uv run --frozen --all-packages --all-extras python experiments/a2-dataset/export_coco.py <dataset>

Writes exports/coco/{train,validation,test,test_standard,test_robustness}.json.
`file_name` is relative to the dataset root. bbox = the VISIBLE box [x, y, w, h];
hidden vehicles (0 visible pixels) are excluded; occluders are not annotated.
Each annotation carries the canonical attributes (amodal box, occlusion, truncation).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_dataset, load_label, load_manifest  # noqa: E402


def build(root: Path, records: list[dict], classes: list[str], version: str) -> dict:
    cat = {c: i + 1 for i, c in enumerate(classes)}
    images, annotations = [], []
    for img_id, r in enumerate(records, 1):
        images.append({"id": img_id, "file_name": r["image"]["path"], "width": r["image"]["width"], "height": r["image"]["height"], "sample_id": r["sample_id"], "split": r["split"], "subset": r["subset"], "environment": r["environment"]["preset_id"]})
        for v in load_label(root, r)["vehicles"]:
            if not v["bbox_visible"]:
                continue
            x0, y0, x1, y1 = v["bbox_visible"]
            annotations.append(
                {
                    "id": len(annotations) + 1,
                    "image_id": img_id,
                    "category_id": cat[v["class"]],
                    "bbox": [x0, y0, x1 - x0, y1 - y0],
                    "area": v["visible_pixels"],
                    "iscrowd": 0,
                    "attributes": {k: v[k] for k in ("instance_id", "space_id", "phase", "bbox_amodal", "truncated", "occlusion", "visible_fraction")},
                }
            )
    return {
        "info": {"description": f"ParkRight OFFLINE simulator dataset {version} (derived from manifest.jsonl)", "version": version},
        "images": images,
        "annotations": annotations,
        "categories": [{"id": i, "name": c, "supercategory": "vehicle"} for c, i in cat.items()],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    root = parser.parse_args().dataset
    manifest = load_manifest(root)
    ds = load_dataset(root)
    out = root / "exports/coco"
    out.mkdir(parents=True, exist_ok=True)
    parts = {
        "train": [r for r in manifest if r["split"] == "train"],
        "validation": [r for r in manifest if r["split"] == "validation"],
        "test": [r for r in manifest if r["split"] == "test"],
        "test_standard": [r for r in manifest if r["split"] == "test" and r["subset"] == "standard"],
        "test_robustness": [r for r in manifest if r["subset"] == "robustness"],
    }
    for name, records in parts.items():
        coco = build(root, records, ds["classes"], ds["dataset_version"])
        (out / f"{name}.json").write_text(json.dumps(coco) + "\n")
        print(f"{name}: {len(coco['images'])} images, {len(coco['annotations'])} boxes")


if __name__ == "__main__":
    main()
