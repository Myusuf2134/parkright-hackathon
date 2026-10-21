# A2 OPEN evidence (evaluation only)

**OPEN REMAINS DISABLED.** `allow_open` is false, production occupancy is OCCUPIED or UNCERTAIN, and
nothing in the production frame path imports the evidence code (pinned by tests). This milestone
builds and measures the evidence a future OPEN decision would need; it does not make that decision.

Branch `feat/a2-open-evidence`, based on `integration/a2-nemotron-demo` at `a696787`, with the
`feat/a2-simulator-dataset` commits cherry-picked to extend the dataset generator.

> **Corrections after the independent audit (made on `feat/a2-bay-tracking`; the original
> branch is unchanged).** See `docs/a2-bay-tracking.md` for the fixes.
>
> 1. **The frozen 360 px motion radius was not the effective radius.** Detections were only
>    collected within `neighbourhood_px` = 300 px of each bay, so the gate that ran had an
>    effective radius of about 300 px. Every result below labelled "360 px" was produced by that
>    ~300 px gate. The library now refuses a motion radius larger than the collection radius.
> 2. **Iteration 2 covered 2,304 combinations** (iteration 1: 1,728). The two iterations are
>    separate DEV searches; the frozen rule came from iteration 2.
> 3. **Production OCCUPIED false positives were not all transitions.** Of the 360 OCCUPIED flags
>    on truth-empty TEST bays, 88 (24%) were in bays that were themselves entering or exiting;
>    272 (76%) were in settled bays, most plausibly a neighbouring or passing vehicle's box
>    spilling over. The sentence "its false positives are vehicles mid-transition" below is
>    wrong; it remains a fail-safe direction (a free bay reported busy), but not for that reason.
> 4. Duplicate protection was window-local, capture timestamps were not required to increase,
>    the empty references came from an earlier dataset's TEST directory, and the seal bound only
>    the rule and manifest. All four are fixed on `feat/a2-bay-tracking`.

## Why absence of a detection is not evidence of an empty bay

Codex's independent evaluation (`feat/a2-open-evaluation`, decision INSUFFICIENT_EVIDENCE) showed
that treating "no qualifying vehicle box" as OPEN gave 22 false OPENs on held-out TEST. Every one
had a detection that missed the 0.65 / 0.45 gates: vehicles mid-transition with partial coverage,
and far-row vehicles behind tall pillars. Veto rules that reached zero did so through incidental
tiny box intersections, not positive evidence. A detector can only say what it saw. It cannot say
that it saw the whole bay, that nothing hid it, or that nothing was moving.

## Evidence model

`services/perception/src/parkright_perception/evidence/` is a pure library. Its inputs are
production-available only: JPEG pixels, calibration polygons, A2 detections, and
detector/calibration/frame status. It has no ground-truth parameter anywhere.

| Signal | How it is measured | Blocks readiness when |
|---|---|---|
| Frame validity | detector ready, checkpoint SHA verified, inference without error, calibration valid, frame size equal to calibration, frame fresh | any fails |
| Visibility | fraction of polygon inside the frame × area adequacy (≥ 1500 px) × ROI exposure (the existing brightness/contrast floor) | < 0.95 |
| Marking visibility | samples along the bay's painted side and back lines (not the aisle edge). Paint must stand out from pavement sampled well inside the bay | below the frozen minimum |
| Empty-reference match (positive empty evidence) | Pearson correlation of the bay's rectified, lighting-normalised appearance with the same bay in operator-confirmed empty reference captures. The best match over references is used, so no lighting label is needed | below the frozen minimum |
| Interior clutter | fraction of the bay's inner region with strong local gradients | above the frozen maximum |
| Vehicle overlap | largest polygon fraction covered by any detection at the model floor (0.05) | above the frozen maximum |
| Occlusion risk | max(foreground cover, 1 − marking visibility). Foreground cover: polygon fraction covered by a detection nearer the camera than the bay | above 1 − minimum marking |
| OCCUPIED evidence | the unchanged production rule (vehicle class, ≥ 0.65 confidence, ≥ 0.45 coverage) | always: overrides everything |
| Transition state | `unknown` with fewer than 2 distinct frames. `suspected` when the bay interior's appearance changed between consecutive distinct frames, a detection within the motion radius moved (no match with IoU ≥ the motion IoU in the previous frame), or a detection partially overlaps the bay. `settled` otherwise | anything but `settled` anywhere in the window |
| Temporal consistency | the last N distinct frames (N = 2, 3 or 5) must all pass every single-frame gate | fewer than N distinct frames, or any failure inside the window |

Markings and the empty reference answer different questions. Paint lies just outside the
calibrated interior, so a parked car leaves its side lines visible. Markings show that the bay's
surroundings are in view and nothing stands in front of them. The reference match shows that the
bay floor looks like the empty floor.

The empty reference is a calibration-time input, like the polygons: an operator confirms empty
captures of this camera. In simulation they are the four v1 `static-empty-<preset>` frames, which
never occur in the temporal dataset.

### Duplicate and ordering protection

`TemporalTracker` (one per camera) accepts a frame into the window only when it is:

- in order: `seq` greater than the last accepted;
- fresh: arrival minus capture ≤ 10 s;
- continuous: ≤ 2 s after the previous accepted frame, otherwise the window restarts;
- distinct: its JPEG SHA-256 is not already in the window.

A new `session_id` restarts the window. Duplicate, out-of-order and stale frames add no
observation and are never ready themselves. Repeated identical frames therefore cannot satisfy a
multi-frame window.

### Output

Per space: `SpaceOpenEvidence {frame_valid, visibility_score, occlusion_risk, vehicle_overlap,
marking_visibility, interior_clutter, distinct_frame_count, temporal_consistency,
transition_state, open_ready, blocking_reasons, advisory_only=true}`. `open_ready` is advisory
evaluation output only.

## Temporal dataset

Version `a2-temporal-v1-d7899ac757`, built from config
`experiments/a2-open-evidence/configs/a2-temporal-v1.json` with `scripts/dataset/build-temporal.sh`.
Output is `~/.cache/parkright/datasets/<version>/`, with git commit and `git_dirty: false` in
`dataset.json`.

- 192 sequences × 10 consecutive frames (500 ms apart) = 1,920 frames, 23,040 space observations.
- Each sequence is one scene: seed, layout, lighting and occluders. Two staggered real manoeuvres
  run through the simulator `World` during every sequence: the first starts at t = 0, the second
  at t = 2 s, and each lasts 3.2 s. Every frame is therefore a distinct scene state, and all
  1,920 images are byte-unique.
- Families (per seed): settled empty ×2, sparse ×2, medium ×2, dense ×2, full ×1; entering ×3;
  exiting ×3; partial occlusion (aisle crate) ×2; severe occlusion (two 4.5 m pillars, one near
  the camera) ×2; pickup/van lots ×2; row patterns ×3. Lighting rotates so every family sees all
  four presets in each split.
- Per frame: sequence/session ID, frame index, `seq`, simulation time, production-shaped
  `frame_metadata` (one session per sequence), per-space truth and phase (`settled`, `entering`,
  `exiting`, from the World's own vehicle phases), occluders, per-vehicle visibility, and the
  calibration version.
- The v1 config, schema and dataset version are unchanged.

### Splits and sealing

- The split unit is the scene seed. Seeds come from `hash(dataset_seed, 'temporal-scene-seed', i)`,
  are ordered by `hash(dataset_seed, 'split', seed)`, and are cut 4 DEV / 4 TEST. Seed, scenario,
  sequence and layout never cross splits, and no seed is shared with A2's training dataset v1.
- There is no train split: nothing is trained here. DEV is the only data used for rule design.
- TEST is sealed in three ways:
  1. `infer.py --split test` and `evaluate.py features|test` refuse to run without
     `FROZEN_RULE.json`. That file binds the rule, its SHA-256 and the dataset manifest SHA-256;
     any change breaks it.
  2. `evaluate.py freeze` refuses to overwrite an existing frozen rule.
  3. `evaluate.py test` writes `RESULTS_TEST.json` once and refuses to run again.

### Validation (`validate_temporal.py`)

The validator checks:

- unique ids and schema;
- clean provenance;
- image and label SHA-256 integrity, JPEG format and dimensions;
- calibration version and pose on every frame, equal to the repository calibration;
- at least 5 frames per sequence, strictly ordered by index, time, simulation time and `seq`;
- one session per sequence;
- no duplicate image inside a sequence or anywhere in the dataset;
- dev/test only, with no seed, group, sequence, scenario or layout leakage, and the sealed seed counts;
- no seed shared with v1;
- complete truth and phase for all 12 spaces;
- transition annotations consistent with events, including the target bay changing state;
- occlusion annotations present;
- label truth equal to manifest truth;
- environment, family and phase coverage per split;
- `frame_metadata` valid against the production `FrameMetadata` contract, which forbids extra fields;
- a byte-identical render-free re-plan, for reproducible logical labels.

## Evaluation methodology

1. Run the production A2 detector (checkpoint SHA-verified) over DEV, and compute evidence from
   pixels and detections only.
2. Score against labels only after decisions exist. For each of 1,728 threshold combinations, run
   the tracker over every DEV sequence in frame order.
3. Select a rule by a criterion fixed before any DEV result was seen. The rule must have:
   - zero false OPEN on DEV;
   - zero transition hazard on DEV (ready while the bay's true phase is entering or exiting);
   - every one-step-looser neighbour in the grid also safe, as a safety margin.

   Among eligible rules, take the highest DEV recall; ties go to the strictest rule.
4. Freeze the rule, run A2 on TEST, and evaluate once.

Definitions:

- **False OPEN:** `open_ready` on a truth-occupied observation. Its rate is per truth-occupied
  observation.
- **Precision and recall:** treat truth-empty as positive.
- **UNCERTAIN rate:** observations neither ready nor production-OCCUPIED.
- **Rejection rates:** the share of truth-empty observations blocked by each category.

## Results

### DEV rule development (TEST sealed throughout)

- **Iteration 1** (motion radius 240/120/40 px, 1,728 combinations): 576 combinations were safe,
  all at 240 px. None had a safe one-step-looser neighbour, so no rule was eligible. **No
  combination produced a false OPEN.** Every unsafe combination failed only on transition
  hazard: a bay marked ready while a car was starting toward it from about 7 m away in the aisle.
- **Iteration 2** added a stricter 360 px radius (2,304 combinations): 1,152 safe, 576 eligible
  with margin.
- **Selected and frozen** (`FROZEN_RULE.json`, rule SHA-256 `640ca4ef14f7…`, committed before any
  TEST frame was processed): reference match ≥ 0.95, marking visibility ≥ 0.6 (occlusion risk
  ≤ 0.4), interior clutter ≤ 0.05, appearance change ≤ 0.02, vehicle overlap 0, motion radius
  360 px, motion IoU 0.9, window 5.
- **DEV with the frozen rule:**

  | Window | Ready | False OPEN | Hazard | Recall |
  |---|---:|---:|---:|---:|
  | 1 | 348 | 0 | 0 | 5.55% |
  | 2 | 264 | 0 | 0 | 4.21% |
  | 3 | 154 | 0 | 0 | 2.46% |
  | 5 | 39 | 0 | 0 | 0.62% |

### Sealed TEST (evaluated once; `RESULTS_TEST.json`)

960 frames, 11,520 space observations (6,162 truth-empty, 5,358 truth-occupied).

| Window | open_ready | False OPEN | False-OPEN rate | Precision | Recall | Coverage | UNCERTAIN | Transition hazard |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 380 | 0 | 0.00% | 1.000 | 6.17% | 3.30% | 47.9% | 0 |
| 2 | 298 | 0 | 0.00% | 1.000 | 4.84% | 2.59% | 48.6% | 0 |
| 3 | 174 | 0 | 0.00% | 1.000 | 2.82% | 1.51% | 49.7% | 0 |
| 5 | 60 | 0 | 0.00% | 1.000 | 0.97% | 0.52% | 50.7% | 0 |

The share of truth-empty observations blocked at window 5 (multi-label) is:

| Reason | Share blocked |
|---|---:|
| Transition | 96.1% |
| Temporal | 83.0% |
| Vehicle overlap | 54.4% |
| Occlusion | 24.8% |
| Surface | 20.4% |
| Visibility | 15.9% |
| Frame | 0.3% |

Window-5 recall by slice:

- **Environment:** night 2.8%, clear day 0.9%, overcast 0.2%, dusk 0.0%. At dusk, the existing
  ROI exposure floor fails.
- **Density:** empty 3.6%, sparse 1.0%, medium 0.3%, dense 0.0%, full 0.0%.
- **State:** settled 1.1%, transition 0.0%.
- **Row:** far (A) 0.7%, near (B) 1.3%.
- **Families:** severe pillar occlusion 1.2%, pickup/van 0.4%, row patterns 0.8%. All had zero
  false OPEN.

Production OCCUPIED (unchanged rule) on these TEST frames: precision 0.936, recall 0.982. Its false
positives are vehicles mid-transition, the safe direction to fail.

A2 CPU latency over the 1,920 frames: mean 2.16 s, median 1.73 s, p95 3.28 s. The machine was
shared with dataset and feature jobs; earlier quiet measurements were about 1.3–1.5 s. GPU
latency has not been measured.

## Decision: INSUFFICIENT_EVIDENCE

The positive-evidence gates never marked an occupied bay ready: zero false OPENs across every DEV
rule tried and on sealed TEST at every window. That is real progress over absence-based rules (22
false OPENs). It is still not sufficient to enable OPEN:

1. **Coverage is too low to be useful.** At the required 5-frame window, 0.97% of empty bays are
   ready. Transition gating has to be very wide (360 px) to stop the approaching-vehicle hazard,
   and every sequence contains moving vehicles.
2. **Safety rests on one wide, conservative gate.** Narrower motion radii produced transition
   hazards on DEV. The approach of a vehicle 7 m away is only caught because the radius is huge.
3. **The empty reference is optimistic in simulation.** The simulated deck is pixel-identical
   across frames, so an empty bay matches its reference almost perfectly. Real pavement, weather,
   dirt and lighting drift will lower matches. The reference needs real-camera calibration and
   maintenance, such as a background model updated only from confirmed-empty frames.
4. **Simulator frames are not independent observations.** Distinct frames come from scene
   motion, not sensor noise or a real temporal process.
5. **Zero failures in 5,358 occupied TEST observations** bounds the false-OPEN rate only below
   about 0.056% (95%, rule of three). That is not a safety case.

## Still required before production OPEN can be enabled

- Real-camera data: a sealed held-out set from the target camera with independently labelled
  empty and occupied bays across lighting and weather, and real consecutive frames.
- An empty-reference procedure that works in the real world: capture, refresh and drift
  detection, with its own false-OPEN evaluation.
- Better transition evidence than a radius: vehicle tracking with heading and velocity toward the
  bay, so the gate can be narrow without hazards.
- Dusk and low-light visibility, which currently fails the exposure floor.
- A pre-registered quantitative safety target (for example a false-OPEN upper bound at 95%
  confidence) and enough held-out occupied observations to demonstrate it.
- A separately reviewed production change to `allow_open`, with OPEN expiring quickly and
  OCCUPIED always winning. Until then, **OPEN REMAINS DISABLED.**

## Reproduce

```sh
scripts/dataset/build-temporal.sh                                   # dataset + 24 validation checks
PY=.venv/bin/python; E=experiments/a2-open-evidence
$PY $E/infer.py --split dev && $PY $E/evaluate.py features --split dev && $PY $E/evaluate.py dev
# Already done and committed: freeze, then the single sealed TEST run.
$PY $E/infer.py --split test --frozen $E/FROZEN_RULE.json
$PY $E/evaluate.py features --split test --frozen $E/FROZEN_RULE.json
$PY $E/evaluate.py test --frozen $E/FROZEN_RULE.json                # refuses if RESULTS_TEST.json exists
$PY -m pytest -q services/perception/tests/test_open_evidence.py experiments/a2-open-evidence/tests
```
