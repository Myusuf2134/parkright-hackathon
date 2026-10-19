# A2 simulator dataset — OFFLINE training/evaluation data

Deterministic, labelled cam-01 frames from the ParkRight Vision Lab, for A2 detector
investigation, fine-tuning and offline evaluation. **Labels are simulator ground truth.
They live in separate files and never enter a production frame request.** This directory
does not train anything and does not touch perception, thresholds or the A0 baseline.

## Commands

From the repository root (Node ≥ 22, `uv`, Playwright Chromium installed):

```sh
scripts/dataset/build.sh                                  # a2-sim-v1 → ~/.cache/parkright/datasets/<version>/
scripts/dataset/build.sh experiments/a2-dataset/configs/a2-sim-smoke.json   # 121-image smoke set
```

`build.sh` runs, in order: generate → a render-free re-plan that must reproduce
`manifest.jsonl` byte for byte → report → QA overlays → COCO export → validate. It exits
nonzero if any check fails. Individual steps:

```sh
node scripts/dataset/generate.mjs [--config <json>] [--out <dir>] [--force] [--plan-only] [--print-out]
PY="uv run --frozen --all-packages --all-extras python"
$PY experiments/a2-dataset/validate.py <dataset> [--compare-manifest <manifest.jsonl>]
$PY experiments/a2-dataset/report.py <dataset>       # reports/summary.{json,md}
$PY experiments/a2-dataset/qa.py <dataset>           # qa/QA-*.png
$PY experiments/a2-dataset/export_coco.py <dataset>  # exports/coco/*.json
```

The output defaults to `$HOME/.cache/parkright/datasets/<dataset_version>/`, outside any
worktree and never under `/tmp` (the generator refuses `/tmp`). The dataset is not
committed; regenerate it with the command above (about 1 minute for a2-sim-v1).

`dataset_version` = `<config name>-<first 10 hex of sha256(config + schema versions)>`.
Changing the config changes the version. `dataset.json` additionally records the git
commit, a sha256 over the simulator scene/camera/dataset sources and calibration, the
browser version and timings.

## Layout

```text
<dataset>/
  manifest.jsonl          canonical: one JSON object per sample (deterministic)
  dataset.json            config, classes, provenance, generation stats
  checksums.sha256        sha256 of every source JPEG as generated
  calibration/cam-01.json copy of packages/shared/calibration/cam-01.json (cam-01-fixed-v1)
  images/{train,validation,test}/<sample_id>.jpg   1280×720, production capture path, quality 0.85
  labels/{train,validation,test}/<sample_id>.json  full labels incl. visibility
  reports/summary.{json,md}
  qa/QA-*.png, qa/QA-contact-sheet.png             OFFLINE DATASET QA overlays (not inputs)
  exports/coco/{train,validation,test,test_standard,test_robustness}.json
```

### `manifest.jsonl` record (canonical)

`sample_id`, `dataset_version`, `split`, `subset` (`standard` | `robustness`), `group_id`
(split unit), `scenario_id`, `scenario_frame_index`, `family`, `kind` (`settled` |
`transition`), `seed`, `environment` (the contract EnvironmentPreset), `camera`
(camera_id, calibration_version, calibration_file, pose), `sim_time_ms`, `frame_metadata`,
`image` (path, width, height, format, jpeg_quality), `labels_path`, `scenario_params`
(density, base_occupancy space→nonce, occluders, transition, pattern), `spaces`
(12 × space_id + truth `occupied`|`empty`), `vehicles` (instance_id, class, space_id, phase,
bbox_amodal, truncated), `counts`. Paths are relative to the dataset root.

`frame_metadata` holds exactly the five production FrameMetadata fields, so a sample can be
replayed through the API (restamp `captured_at`; the API rejects stale frames). It carries
no ground truth; the validator checks this against the real Pydantic contract.

### Label file

Everything in the manifest record's labels plus: `spaces[].polygon_px` (calibration
polygon in pixels), per vehicle `color`, `world` pose and size (m), `bbox_projected`
(unclamped), and visibility: `visible_pixels`, `unoccluded_pixels`, `visible_fraction`,
`bbox_visible`, `occlusion`; `objects` (occluders with `bbox_amodal`). Boxes are pixels
`[x_min, y_min, x_max, y_max]`, origin top-left.

## How labels are made

- **Space truth** is the simulator's `World.truth()`: a bay is occupied when a vehicle's
  centre is inside it, including one still pulling in or out. It is the same function that
  feeds the evaluation route.
- **Amodal box**: the vehicle mesh is rebuilt with the simulator's `buildVehicle(spec)`,
  placed exactly as `VehicleLayer` places it, and every mesh vertex is projected through a
  `PerspectiveCamera` built like cam-01 (asserted equal to the live cam-01 camera and to
  the calibration). min/max, then clamped to the image; `truncated` = clamping cut it.
- **Visibility / visible box**: an ID render (flat unlit colour per vehicle, everything
  else black, no antialiasing) through the same camera, and a solo render per vehicle.
  `visible_fraction = visible / unoccluded`; `bbox_visible` bounds the visible pixels.
  For unoccluded vehicles the visible and amodal boxes agree within 1 px, which
  cross-checks both methods.
- **Inclusion**: every vehicle on the deck is listed. `occlusion`: `none` ≥ 0.95,
  `partial` ≥ 0.5, `heavy` > 0, `hidden` = 0 visible pixels (`bbox_visible` null).
  COCO export uses `bbox_visible` and drops `hidden`; occluders are not annotated.
  Nothing is labelled by hand or by a detector.
- Visibility is measured by rasterisation, so it may differ by a pixel across GPUs; it is
  outside the logical determinism guarantee (on one machine it reproduces exactly).

## Scenarios (a2-sim-v1)

Per main scene seed (30 seeds):

| family | per seed | environments |
|---|---|---|
| settled | 7 layouts (sparse ×2, medium ×2, dense ×2, full ×1) | clear_day, overcast, dusk, night |
| occlusion | 2 layouts + a crate (2–3.5 × 1.6–2.4 m) standing in the aisle | clear_day, dusk |
| transition | 1 arrival + 1 departure, each at 35 % and 70 % of the manoeuvre | clear_day, night |

Plus `static_empty` (4 images, one per environment). Layouts pick bays and vehicle nonces
from `rng(seed, …)`; vehicle style, colour, size, offset and yaw come from the
simulator's own `generateVehicle(seed, space, nonce)`.

Only the four existing presets are used; the simulator has no weather effects yet, so
none are claimed. A low barrier in front of row B was tried first and rejected: from
cam-01's 10.5 m mount it sits below every line of sight and occludes nothing.

## Splits

- **Split unit = scene seed.** All layouts, lighting variants, occluder and transition
  frames of a seed share one split, so near-identical frames never cross splits.
- Main seeds are `hash(dataset_seed, 'scene-seed', i)`; they are ordered by
  `hash(dataset_seed, 'split', seed)` and cut 20 / 5 / 5 into train / validation / test
  (`assignSplits` in `apps/simulator/src/dataset/plan.ts`). Every test vehicle instance
  and layout is therefore unseen in training.
- **The empty deck renders identically for every seed** (the deck uses a fixed seed),
  so the 4 `static_empty` images are one group, assigned to **test**. Train has no
  all-empty frame, but its 800 images contain 4638 empty-bay labels.
- **Robustness subset** (`split=test`, `subset=robustness`, 80 images): 4 separate seeds,
  never used elsewhere, and families that never occur in train/validation/standard test:
  `robust_pillar` (two 4.5 m pillars, one near the camera; day/dusk/night),
  `robust_large_vehicles` (lots made only of pickups and vans; 4 environments),
  `robust_row_pattern` (row A only, row B only, checkerboard; overcast/night).
- The validator fails on any seed, group, scenario or layout appearing in two splits,
  on robustness samples outside test or sharing a seed, and on a robustness row pattern
  that also occurs in train.

## Validation

`validate.py` checks: unique ids; images exist, are JPEG, match manifest dimensions and
generation checksums; no orphan images or labels; labels reference their sample; boxes
inside the image with positive area; valid polygons; exactly 12 labelled spaces; settled
truth equals the layout; valid classes; consistent visibility; split membership and
directory; group/seed/scenario/layout leakage; robustness isolation; environment and
density coverage per split; production FrameMetadata contract unchanged and every
`frame_metadata` valid against it with no extra field; QA files never byte-identical to a
source image; and (with `--compare-manifest`) byte-identical regeneration.

Tests: `uv run --frozen --all-packages --all-extras pytest experiments/a2-dataset/test_validate.py`
(validator catches each defect) and `npm run test:sim` (`apps/simulator/test/dataset.test.ts`:
plan determinism, splits, projection vs calibration, transitions, and that dataset code
never imports `src/stream` or uses the network, and the production app never imports it).

## Production isolation

The renderer page `apps/simulator/dataset.html` is served only by the Vite dev server the
generator starts; it is not part of `vite build` (only `index.html` is). It never uploads:
it has no API client, and the generator fails if the page requests any `/api/` URL. QA
overlays are PNGs under `qa/` with an `OFFLINE DATASET QA` banner; source JPEGs are only
read.
