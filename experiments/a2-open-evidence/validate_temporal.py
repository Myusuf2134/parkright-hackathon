#!/usr/bin/env python3
"""Validate the OFFLINE temporal OPEN-evidence dataset. Exits nonzero on any failed check.

    python validate_temporal.py [<dataset>] [--compare-manifest <plan-only manifest.jsonl>] [--v1 <a2-sim-v1 dataset>]
"""

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from seal import DATASET  # noqa: E402

SPACES = [f"{r}{i}" for r in "AB" for i in range(1, 7)]
PHASES = {"settled", "entering", "exiting"}
PRESETS = {"clear_day", "overcast", "dusk", "night"}
OCCLUSION_FAMILIES = {"occlusion_partial", "occlusion_severe"}
TARGET_FAMILIES = {"entering", "exiting"}
MIN_FRAMES = 5


class Report:
    def __init__(self):
        self.passed, self.errors = [], []

    def check(self, name: str, problems: list[str]):
        if problems:
            self.errors.append(f"{name}: {len(problems)} problem(s), e.g. {problems[:3]}")
        else:
            self.passed.append(name)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(root: Path, compare: Path | None = None, v1: Path | None = None) -> Report:
    rep = Report()
    manifest_path = root / "manifest.jsonl"
    records = [json.loads(line) for line in manifest_path.open()]
    meta = json.loads((root / "dataset.json").read_text())
    config = meta["config"]
    ids = [r["sample_id"] for r in records]
    rep.check("unique sample ids", [i for i, n in Counter(ids).items() if n > 1])
    rep.check("schema and kind", [r["sample_id"] for r in records if r.get("schema") != "parkright-temporal-sample-v1" or r["subset"] != "temporal"]
              + ([] if meta.get("schema") == "parkright-temporal-dataset-v1" else ["dataset.json schema"]))
    prov = meta.get("provenance", {})
    rep.check("provenance recorded and clean", [k for k in ("git_commit", "simulator_source_sha256") if not prov.get(k)] + (["git_dirty"] if prov.get("git_dirty") is not False else []))

    # Integrity: images and labels.
    sums = dict(reversed(line.split()) for line in (root / "checksums.sha256").read_text().splitlines())
    bad_img, bad_dim = [], []
    from PIL import Image

    for r in records:
        p = root / r["image"]["path"]
        if not p.is_file() or sums.get(r["image"]["path"]) != sha256(p):
            bad_img.append(r["sample_id"])
            continue
        with Image.open(p) as im:
            if im.format != "JPEG" or im.size != (r["image"]["width"], r["image"]["height"]):
                bad_dim.append(r["sample_id"])
    rep.check("images exist and match generation checksums", bad_img)
    rep.check("images are JPEG with manifest dimensions", bad_dim)
    label_sums_path = root / "labels.sha256"
    label_sums = dict(reversed(line.split()) for line in label_sums_path.read_text().splitlines()) if label_sums_path.exists() else {}
    bad_lab, labels = [], {}
    for r in records:
        p = root / r["labels_path"]
        if not p.is_file() or label_sums.get(r["labels_path"]) != sha256(p):
            bad_lab.append(r["sample_id"])
            continue
        labels[r["sample_id"]] = json.loads(p.read_text())
    rep.check("labels exist and match generation checksums", bad_lab)
    rep.check("labels reference their sample", [i for i, lab in labels.items() if lab["sample_id"] != i])

    # Calibration.
    repo_cal = ROOT / "packages/shared/calibration/cam-01.json"
    cal = json.loads((root / "calibration/cam-01.json").read_text())
    rep.check("calibration version recorded on every frame and equal to the repository calibration",
              [r["sample_id"] for r in records if r["camera"]["calibration_version"] != cal["version"] or r["camera"]["pose"] != cal["pose"]]
              + ([] if sha256(root / "calibration/cam-01.json") == sha256(repo_cal) else ["calibration file differs"]))

    # Sequences.
    seqs = defaultdict(list)
    for r in records:
        seqs[r["sequence_id"]].append(r)
    short, order, session, dup_seq = [], [], [], []
    for sid, rs in seqs.items():
        if len(rs) < MIN_FRAMES:
            short.append(sid)
        idx = [r["frame_index"] for r in rs]
        times = [r["t_ms"] for r in rs]
        sim = [r["sim_time_ms"] for r in rs]
        seqn = [r["frame_metadata"]["seq"] for r in rs]
        if idx != list(range(len(rs))) or any(b <= a for a, b in zip(times, times[1:])) or any(b <= a for a, b in zip(sim, sim[1:])) or any(b <= a for a, b in zip(seqn, seqn[1:])):
            order.append(sid)
        if len({r["frame_metadata"]["session_id"] for r in rs}) != 1 or any(r["frame_count"] != len(rs) for r in rs):
            session.append(sid)
        hashes = [sums.get(r["image"]["path"]) for r in rs]
        if len(set(hashes)) != len(hashes):
            dup_seq.append(sid)
    rep.check(f"every sequence has at least {MIN_FRAMES} frames", short)
    rep.check("frames strictly ordered (index, time, sim time, seq)", order)
    rep.check("one session per sequence", session + [s for s, n in Counter(next(iter(rs))["frame_metadata"]["session_id"] for rs in seqs.values()).items() if n > 1])
    rep.check("no duplicate frame within a sequence", dup_seq)
    rep.check("no identical image anywhere in the dataset (no cross-split image leakage)", [h for h, n in Counter(sums.values()).items() if n > 1])

    # Splits and leakage.
    leaks = []
    for key in ("seed", "group_id", "sequence_id", "scenario_id"):
        splits = defaultdict(set)
        for r in records:
            splits[r[key]].add(r["split"])
        leaks += [f"{key}={k}" for k, v in splits.items() if len(v) > 1]
    layouts = defaultdict(set)
    for r in records:
        layouts[(r["seed"], json.dumps(r["scenario_params"]["base_occupancy"], sort_keys=True))].add(r["split"])
    leaks += [f"layout {k[0]}" for k, v in layouts.items() if len(v) > 1]
    rep.check("split is exactly dev or test", [r["sample_id"] for r in records if r["split"] not in ("dev", "test") or not r["image"]["path"].startswith(f"images/{r['split']}/")])
    rep.check("no seed/group/sequence/scenario/layout leakage across splits", leaks)
    seeds = Counter()
    for s in {(r["seed"], r["split"]) for r in records}:
        seeds[s[1]] += 1
    rep.check("seed groups match the sealed config", [] if dict(seeds) == config["seed_groups"] else [f"{dict(seeds)} != {config['seed_groups']}"])
    if v1 and (v1 / "manifest.jsonl").is_file():
        v1_seeds = {json.loads(line)["seed"] for line in (v1 / "manifest.jsonl").open()}
        rep.check("no scene seed shared with the A2 training dataset v1", sorted({r["seed"] for r in records} & v1_seeds))

    # Ground truth, transitions, occlusion.
    gt = []
    for r in records:
        sp = r["spaces"]
        if sorted(s["space_id"] for s in sp) != SPACES or any(s["truth"] not in ("occupied", "empty") or s.get("phase") not in PHASES for s in sp):
            gt.append(r["sample_id"])
    rep.check("ground truth complete (12 spaces with truth and phase per frame)", gt)
    trans = []
    for sid, rs in seqs.items():
        events = rs[0]["scenario_params"]["events"]
        if len(events) < 2 or any(r["scenario_params"]["events"] != events for r in rs):
            trans.append(f"{sid}: events")
        for e in events:
            if not any(next(s for s in r["spaces"] if s["space_id"] == e["space_id"])["phase"] != "settled" for r in rs):
                trans.append(f"{sid}: {e['space_id']} never in transition")
        if rs[0]["family"] in TARGET_FAMILIES:
            t = next(e for e in events if e["role"] == "target")
            first, last = (next(s for s in r["spaces"] if s["space_id"] == t["space_id"])["truth"] for r in (rs[0], rs[-1]))
            if (first, last) != (("empty", "occupied") if t["kind"] == "arrive" else ("occupied", "empty")):
                trans.append(f"{sid}: target {first}->{last}")
    rep.check("transition annotations present and consistent with events", trans)
    occ = []
    for r in records:
        lab = labels.get(r["sample_id"])
        if lab is None:
            continue
        if r["family"] in OCCLUSION_FAMILIES and (not r["scenario_params"]["occluders"] or not lab["objects"] or any(o.get("bbox_amodal") is None for o in lab["objects"])):
            occ.append(r["sample_id"])
        if any(v.get("occlusion") is None or v.get("visible_fraction") is None for v in lab["vehicles"]):
            occ.append(r["sample_id"])
    rep.check("occlusion annotations present (occluders + per-vehicle visibility)", occ)
    by_id = {r["sample_id"]: r for r in records}
    labels_truth = [i for i, lab in labels.items() if [(s["space_id"], s["truth"]) for s in lab["spaces"]] != [(s["space_id"], s["truth"]) for s in by_id[i]["spaces"]]]
    rep.check("label truth equals manifest truth", labels_truth)

    # Coverage.
    cov = []
    for split in ("dev", "test"):
        rs = [r for r in records if r["split"] == split]
        envs = {r["environment"]["preset_id"] for r in rs}
        fams = {r["family"] for r in rs}
        cov += [f"{split}: env {e}" for e in PRESETS - envs] + [f"{split}: family {f}" for f, n in config["families"].items() if n and f not in fams]
        if not {s["phase"] for r in rs for s in r["spaces"]} >= PHASES:
            cov.append(f"{split}: phases")
    rep.check("environment, family and phase coverage per split", cov)

    # Production contract: frame_metadata is exactly FrameMetadata, with no ground truth.
    from parkright_contracts import FrameMetadata
    from pydantic import ValidationError

    contract = []
    for r in records:
        try:
            FrameMetadata.model_validate(r["frame_metadata"])
        except ValidationError:
            contract.append(r["sample_id"])
    rep.check("frame_metadata is a valid production FrameMetadata with no extra field", contract
              + ([] if FrameMetadata.model_config.get("extra") == "forbid" else ["FrameMetadata no longer forbids extra fields"]))

    if compare is not None:
        rep.check("reproducible logical labels (plan-only manifest byte-identical)", [] if compare.read_bytes() == manifest_path.read_bytes() else ["manifest differs"])
    return rep


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("dataset", type=Path, nargs="?", default=DATASET)
    p.add_argument("--compare-manifest", type=Path)
    p.add_argument("--v1", type=Path, default=Path.home() / ".cache/parkright/datasets/a2-sim-v1-b569da957c")
    a = p.parse_args()
    rep = validate(a.dataset, a.compare_manifest, a.v1)
    for name in rep.passed:
        print(f"PASS {name}")
    for e in rep.errors:
        print(f"FAIL {e}")
    print(f"{len(rep.passed)} passed, {len(rep.errors)} failed")
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()
