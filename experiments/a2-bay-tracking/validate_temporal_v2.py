#!/usr/bin/env python3
"""Validate the OFFLINE temporal v2 dataset (bay tracking). Exits nonzero on any failed check.

    python validate_temporal_v2.py [<dataset>] [--compare-manifest <plan-only manifest.jsonl>]
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
PHASES = {"settled", "entering", "exiting", "approaching", "aborting", "paused_near"}
PRESETS = {"clear_day", "overcast", "dusk", "night"}
DENSITIES = {"empty", "sparse", "medium", "dense", "full"}
MIN_FRAMES = 10
CACHE = Path.home() / ".cache/parkright/datasets"
EARLIER = {"A2 training dataset a2-sim-v1": CACHE / "a2-sim-v1-b569da957c", "temporal v1 (prior DEV/TEST)": CACHE / "a2-temporal-v1-d7899ac757"}


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


def target_of(r):
    return [s for s, role in r["scenario_params"]["roles"].items() if role == "target"]


def validate(root: Path, compare: Path | None = None, earlier: dict[str, Path] = EARLIER) -> Report:
    rep = Report()
    manifest_path = root / "manifest.jsonl"
    records = [json.loads(line) for line in manifest_path.open()]
    meta = json.loads((root / "dataset.json").read_text())
    config = meta["config"]
    rep.check("unique sample ids", [i for i, n in Counter(r["sample_id"] for r in records).items() if n > 1])
    rep.check("schema", [r["sample_id"] for r in records if r.get("schema") != "parkright-temporal-sample-v2"]
              + ([] if meta.get("schema") == "parkright-temporal-dataset-v2" else ["dataset.json schema"]))
    prov = meta.get("provenance", {})
    rep.check("provenance recorded and clean", [k for k in ("git_commit", "simulator_source_sha256") if not prov.get(k)] + (["git_dirty"] if prov.get("git_dirty") is not False else []))

    sums = dict(reversed(line.split()) for line in (root / "checksums.sha256").read_text().splitlines())
    from PIL import Image

    bad_img, bad_dim = [], []
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
    label_sums = dict(reversed(line.split()) for line in (root / "labels.sha256").read_text().splitlines())
    bad_lab, labels = [], {}
    for r in records:
        p = root / r["labels_path"]
        if not p.is_file() or label_sums.get(r["labels_path"]) != sha256(p):
            bad_lab.append(r["sample_id"])
            continue
        labels[r["sample_id"]] = json.loads(p.read_text())
    rep.check("labels exist and match generation checksums", bad_lab)

    cal = json.loads((root / "calibration/cam-01.json").read_text())
    rep.check("calibration recorded on every frame and equal to the repository calibration",
              [r["sample_id"] for r in records if r["camera"]["calibration_version"] != cal["version"] or r["camera"]["pose"] != cal["pose"]]
              + ([] if sha256(root / "calibration/cam-01.json") == sha256(ROOT / "packages/shared/calibration/cam-01.json") else ["calibration file differs"]))

    temporal = [r for r in records if r["subset"] == "temporal"]
    refs = [r for r in records if r["subset"] == "reference"]
    seqs = defaultdict(list)
    for r in temporal:
        seqs[r["sequence_id"]].append(r)
    short, order, session, dup = [], [], [], []
    for sid, rs in seqs.items():
        if len(rs) < MIN_FRAMES:
            short.append(sid)
        idx = [r["frame_index"] for r in rs]
        cap = [r["frame_metadata"]["captured_at"] for r in rs]
        seqn = [r["frame_metadata"]["seq"] for r in rs]
        if idx != list(range(len(rs))) or any(b <= a for a, b in zip(cap, cap[1:])) or any(b <= a for a, b in zip(seqn, seqn[1:])):
            order.append(sid)
        if len({r["frame_metadata"]["session_id"] for r in rs}) != 1 or any(r["frame_count"] != len(rs) for r in rs):
            session.append(sid)
        hashes = [sums.get(r["image"]["path"]) for r in rs]
        if len(set(hashes)) != len(hashes):
            dup.append(sid)
    rep.check(f"every sequence has at least {MIN_FRAMES} frames", short)
    rep.check("frames strictly ordered (index, capture time, seq)", order)
    rep.check("one session per sequence", session + [s for s, n in Counter(rs[0]["frame_metadata"]["session_id"] for rs in seqs.values()).items() if n > 1])
    rep.check("no repeated image within a sequence", dup)
    rep.check("no identical image anywhere in the dataset (incl. reference captures)", [h for h, n in Counter(sums.values()).items() if n > 1])

    # Splits.
    leaks = []
    for key in ("seed", "group_id", "sequence_id", "scenario_id"):
        splits = defaultdict(set)
        for r in records:
            splits[r[key]].add(r["split"])
        leaks += [f"{key}={k}" for k, v in splits.items() if len(v) > 1]
    rep.check("split is reference, dev or test, matching the image path",
              [r["sample_id"] for r in records if r["split"] not in ("reference", "dev", "test") or not r["image"]["path"].startswith(f"images/{r['split']}/")])
    rep.check("no seed/group/sequence/scenario leakage across splits", leaks)
    seeds = Counter(s for _, s in {(r["seed"], r["split"]) for r in records})
    rep.check("seed groups match the config", [] if dict(seeds) == config["seed_groups"] else [f"{dict(seeds)} != {config['seed_groups']}"])
    ours = {r["seed"] for r in records}
    shared = []
    for name, path in earlier.items():
        m = path / "manifest.jsonl"
        if not m.is_file():
            shared.append(f"{name}: manifest missing, cannot check")
            continue
        shared += [f"{name}: seed {s}" for s in sorted(ours & {json.loads(line)["seed"] for line in m.open()})]
    rep.check("no scene seed shared with the A2 training data or the prior temporal DEV/TEST", shared)
    rep.check("reference split holds single calibration captures only",
              [r["sample_id"] for r in refs if r["frame_count"] != 1 or r["scenario_params"]["scripts"] or r["family"] != "reference"]
              + [r["sample_id"] for r in temporal if r["split"] == "reference"]
              + ([] if {r["environment"]["preset_id"] for r in refs} == PRESETS else ["reference presets"]))

    # Ground truth and scenario semantics.
    gt = [r["sample_id"] for r in records if sorted(s["space_id"] for s in r["spaces"]) != SPACES
          or any(s["truth"] not in ("occupied", "empty") or s.get("phase") not in PHASES or "intrusion" not in s or "occupied_within_horizon" not in s for s in r["spaces"])]
    rep.check("ground truth complete (truth, phase, intrusion, horizon per space)", gt)
    sem = []
    for sid, rs in seqs.items():
        fam = rs[0]["family"]
        targets = target_of(rs[0])
        truth = lambda r, s: next(x for x in r["spaces"] if x["space_id"] == s)  # noqa: E731
        if any(r["scenario_params"]["scripts"] != rs[0]["scenario_params"]["scripts"] for r in rs):
            sem.append(f"{sid}: scripts differ between frames")
        if fam in ("entering", "neighbor_approach", "detector_dropout", "occluded_approach", "large_vehicles", "two_vehicles"):
            for t in targets:
                if (truth(rs[0], t)["truth"], truth(rs[-1], t)["truth"]) != ("empty", "occupied"):
                    sem.append(f"{sid}: {t} does not go empty→occupied")
        if fam == "exiting":
            t = targets[0]
            if (truth(rs[0], t)["truth"], truth(rs[-1], t)["truth"]) != ("occupied", "empty"):
                sem.append(f"{sid}: {t} does not go occupied→empty")
        if fam in ("aborted_approach", "pause_near"):
            t = targets[0]
            if any(truth(r, t)["truth"] == "occupied" for r in rs):
                sem.append(f"{sid}: {t} occupied during a non-parking manoeuvre")
            want = {"aborted_approach": {"approaching", "aborting"}, "pause_near": {"paused_near"}}[fam]
            if not want <= {truth(r, t)["phase"] for r in rs}:
                sem.append(f"{sid}: {t} phases {want} missing")
        if fam == "neighbor_approach" and any(truth(rs[0], n)["truth"] != "empty" for n, role in rs[0]["scenario_params"]["roles"].items() if role == "neighbor"):
            sem.append(f"{sid}: neighbour not empty")
        if fam == "occluded_approach" and not any(o["kind"] == "screen" for o in rs[0]["scenario_params"]["occluders"]):
            sem.append(f"{sid}: no screen")
        drop = rs[0]["scenario_params"]["dropout_frames"]
        if (fam == "detector_dropout") != bool(drop) or any(i >= len(rs) for i in drop):
            sem.append(f"{sid}: dropout frames {drop}")
        if fam == "pass_by" and any(s["phase"] != "settled" for r in rs for s in r["spaces"]):
            sem.append(f"{sid}: pass-by changed a bay phase")
    rep.check("scenario semantics (targets, phases, neighbours, occluders, dropout)", sem)
    by_id = {r["sample_id"]: r for r in records}
    rep.check("label truth equals manifest truth",
              [i for i, lab in labels.items() if [(s["space_id"], s["truth"]) for s in lab["spaces"]] != [(s["space_id"], s["truth"]) for s in by_id[i]["spaces"]]])
    rep.check("per-vehicle visibility annotations present",
              [i for i, lab in labels.items() if any(v.get("occlusion") is None or v.get("visible_fraction") is None for v in lab["vehicles"])])

    cov = []
    for split in ("dev", "test"):
        rs = [r for r in temporal if r["split"] == split]
        for fam in config["families"]:
            envs = {r["environment"]["preset_id"] for r in rs if r["family"] == fam}
            cov += [f"{split}: {fam} lacks {e}" for e in PRESETS - envs]
        cov += [f"{split}: density {d}" for d in DENSITIES - {r["scenario_params"]["density"] for r in rs}]
        cov += [f"{split}: phase {p}" for p in PHASES - {s["phase"] for r in rs for s in r["spaces"]}]
        kinds = {v["class"] for r in rs for v in r["vehicles"]}
        cov += [f"{split}: vehicle {k}" for k in ("pickup", "van") if k not in kinds]
        cov += [f"{split}: pattern {p}" for p in ("row_a_only", "row_b_only", "checkerboard") if p not in {r["scenario_params"]["pattern"] for r in rs}]
    rep.check("family × environment, density, phase, vehicle and row-pattern coverage per split", cov)

    from parkright_contracts import FrameMetadata
    from pydantic import ValidationError

    contract = []
    for r in records:
        try:
            FrameMetadata.model_validate(r["frame_metadata"])
        except ValidationError:
            contract.append(r["sample_id"])
    rep.check("frame_metadata is a valid production FrameMetadata with no extra field", contract)
    if compare is not None:
        rep.check("reproducible logical labels (plan-only manifest byte-identical)", [] if compare.read_bytes() == manifest_path.read_bytes() else ["manifest differs"])
    return rep


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("dataset", type=Path, nargs="?", default=DATASET)
    p.add_argument("--compare-manifest", type=Path)
    a = p.parse_args()
    rep = validate(a.dataset, a.compare_manifest)
    for name in rep.passed:
        print(f"PASS {name}")
    for e in rep.errors:
        print(f"FAIL {e}")
    print(f"{len(rep.passed)} passed, {len(rep.errors)} failed")
    sys.exit(1 if rep.errors else 0)


if __name__ == "__main__":
    main()
