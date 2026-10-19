"""Summarise an OFFLINE A2 simulator dataset → reports/summary.json and reports/summary.md.

    uv run --frozen --all-packages --all-extras python experiments/a2-dataset/report.py <dataset>

Object sizes are reported in native 1280x720 pixels and as they arrive at a 300x300
detector input after a plain (non-aspect-preserving) resize, as SSD300 preprocessing does.
"""

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SPLITS, load_dataset, load_label, load_manifest  # noqa: E402


def pct(values, ps=(0, 5, 25, 50, 75, 95, 100)):
    if not values:
        return None
    v = sorted(values)
    return {f"p{p}": round(v[min(len(v) - 1, round(p / 100 * (len(v) - 1)))], 1) for p in ps}


def du(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file())


def summarise(root: Path) -> dict:
    manifest = load_manifest(root)
    ds = load_dataset(root)
    labels = {r["sample_id"]: load_label(root, r) for r in manifest}
    split_counts = Counter(r["split"] for r in manifest)
    subsets = Counter((r["split"], r["subset"]) for r in manifest)
    truth = Counter(s["truth"] for r in manifest for s in r["spaces"])
    vehicles = [v for lab in labels.values() for v in lab["vehicles"]]
    visible = [v for v in vehicles if v["bbox_visible"]]
    w, h = 1280, 720

    def sizes(vs, sx=1.0, sy=1.0):
        ws = [(v["bbox_visible"][2] - v["bbox_visible"][0]) * sx for v in vs]
        hs = [(v["bbox_visible"][3] - v["bbox_visible"][1]) * sy for v in vs]
        return {"width": pct(ws), "height": pct(hs), "sqrt_area": pct([math.sqrt(a * b) for a, b in zip(ws, hs)])}

    rows = {"far_row_A": [v for v in visible if v["space_id"].startswith("A")], "near_row_B": [v for v in visible if v["space_id"].startswith("B")]}
    return {
        "dataset_version": ds["dataset_version"],
        "total_images": len(manifest),
        "splits": {s: split_counts.get(s, 0) for s in SPLITS},
        "subsets": {f"{a}/{b}": n for (a, b), n in sorted(subsets.items())},
        "robustness_images": sum(1 for r in manifest if r["subset"] == "robustness"),
        "scenarios": len({r["scenario_id"] for r in manifest}),
        "seeds": len({r["seed"] for r in manifest if r["family"] != "static_empty"}),
        "families": dict(Counter(r["family"] for r in manifest)),
        "environments": dict(Counter(r["environment"]["preset_id"] for r in manifest)),
        "environment_by_split": {s: dict(Counter(r["environment"]["preset_id"] for r in manifest if r["split"] == s)) for s in SPLITS},
        "density": dict(Counter(r["scenario_params"]["density"] for r in manifest)),
        "density_by_split": {s: dict(Counter(r["scenario_params"]["density"] for r in manifest if r["split"] == s)) for s in SPLITS},
        "kinds": dict(Counter(r["kind"] for r in manifest)),
        "space_truth": {"OCCUPIED": truth.get("occupied", 0), "OPEN (empty)": truth.get("empty", 0)},
        "vehicle_instances": len(vehicles),
        "vehicle_types": dict(Counter(v["class"] for v in vehicles)),
        "vehicle_types_by_split": {s: dict(Counter(v["class"] for r in manifest if r["split"] == s for v in labels[r["sample_id"]]["vehicles"])) for s in SPLITS},
        "occlusion": dict(Counter(v["occlusion"] for v in vehicles)),
        "partially_visible_vehicles": sum(1 for v in vehicles if v["occlusion"] in ("partial", "heavy") or v["truncated"]),
        "truncated_vehicles": sum(1 for v in vehicles if v["truncated"]),
        "hidden_vehicles": sum(1 for v in vehicles if v["occlusion"] == "hidden"),
        "visible_box_px_native_1280x720": {"all": sizes(visible), **{k: sizes(v) for k, v in rows.items()}},
        "visible_box_px_at_300x300_input": {"all": sizes(visible, 300 / w, 300 / h), **{k: sizes(v, 300 / w, 300 / h) for k, v in rows.items()}},
        "disk_bytes": du(root),
        "generation": ds["generation"],
        "provenance": ds["provenance"],
    }


def markdown(s: dict) -> str:
    def table(d):
        return "\n".join(f"| {k} | {v} |" for k, v in d.items())

    def sizes(title, block):
        out = [f"\n### {title}\n", "| subset | width p5/p50/p95 | height p5/p50/p95 | sqrt(area) p5/p50/p95 |", "|---|---|---|---|"]
        for k, v in block.items():
            f = lambda m: f"{m['p5']} / {m['p50']} / {m['p95']}"  # noqa: E731
            out.append(f"| {k} | {f(v['width'])} | {f(v['height'])} | {f(v['sqrt_area'])} |")
        return "\n".join(out)

    g = s["generation"]
    return "\n".join(
        [
            f"# OFFLINE DATASET summary — `{s['dataset_version']}`\n",
            "Simulator ground truth for training/evaluation only. Never part of a production frame.\n",
            f"- Images: **{s['total_images']}** (train {s['splits']['train']}, validation {s['splits']['validation']}, test {s['splits']['test']}; of test, robustness {s['robustness_images']})",
            f"- Scenarios: {s['scenarios']}; scene seeds: {s['seeds']}",
            f"- Vehicle instances: {s['vehicle_instances']}; partially visible: {s['partially_visible_vehicles']}; hidden: {s['hidden_vehicles']}",
            f"- Space truth: OCCUPIED {s['space_truth']['OCCUPIED']}, OPEN (empty) {s['space_truth']['OPEN (empty)']}",
            f"- Disk: {s['disk_bytes'] / 1e6:.1f} MB; generation {g['total_seconds']} s ({g['images_per_second']} img/s)",
            "\n## Environments\n\n| preset | images |\n|---|---|\n" + table(s["environments"]),
            "\n## Occupancy density\n\n| density | images |\n|---|---|\n" + table(s["density"]),
            "\n## Families\n\n| family | images |\n|---|---|\n" + table(s["families"]),
            "\n## Vehicle types\n\n| class | instances |\n|---|---|\n" + table(s["vehicle_types"]),
            "\n## Occlusion\n\n| level | instances |\n|---|---|\n" + table(s["occlusion"]),
            "\n## Visible vehicle box sizes (pixels)",
            sizes("Native 1280×720", s["visible_box_px_native_1280x720"]),
            sizes("At a 300×300 detector input (plain resize, as SSD300)", s["visible_box_px_at_300x300_input"]),
            "",
        ]
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    root = parser.parse_args().dataset
    s = summarise(root)
    (root / "reports").mkdir(exist_ok=True)
    (root / "reports/summary.json").write_text(json.dumps(s, indent=2) + "\n")
    (root / "reports/summary.md").write_text(markdown(s))
    print(markdown(s))


if __name__ == "__main__":
    main()
