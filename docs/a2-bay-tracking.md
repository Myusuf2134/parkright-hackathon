# A2 bay-specific tracking (evaluation only)

**OPEN REMAINS DISABLED.** `allow_open` is false, production occupancy is OCCUPIED or UNCERTAIN,
and nothing in the production runtime imports the evidence or tracking code (pinned by tests,
including a subprocess check of `create_app`). Production perception (A0, A2 calibrated mapping)
and the Nemotron recommendation code are byte-identical to `integration/a2-nemotron-demo`
(`a696787`), pinned by file hashes in `test_bay_tracking.py`. Nothing here, including a clean
simulator TEST result, authorizes production OPEN.

Branch `feat/a2-bay-tracking`, based on `feat/a2-open-evidence` at `bb57eb9`.

**Result (sealed TEST, evaluated once, frozen window-5 tracking policy):** 111 of 13,824 space
observations OPEN-ready, **0 false OPEN, 0 transition hazards**, precision 1.0, recall 1.46% of
empty bays, coverage 0.80% (v1 coverage on its own sealed TEST: 0.52%). **Conclusion:
INSUFFICIENT_EVIDENCE for OPEN.** Bay-specific tracking is safer-by-design than a blanket
radius and gains coverage, but coverage stays around 1%, it is zero for bays next to an approach,
in dense or full lots and at dusk, and everything here is simulation.

## 1. Audit findings fixed

| # | Finding (Codex audit of `bb57eb9`) | Fix | Pinned by |
|---|---|---|---|
| 1 | Frozen `motion_radius_px` 360 but detections prefiltered at `neighbourhood_px` 300: effective radius ~300 px | `EvidenceConfig` refuses `neighbourhood_px < motion_radius_px` (default now 480); every `SpaceFrameEvidence` records `near_radius_px`; the coarse gate raises if its radius exceeds it. Never capped silently | `test_neighbourhood_smaller_than_motion_radius_is_refused`, `test_gate_refuses_radius_larger_than_collected_evidence`, `test_vehicle_between_300_and_360_px_is_seen_by_a_360_px_gate` |
| 2 | Duplicate protection window-local: a replayed JPEG could count again after leaving the deque | `SeenFrames` per session: exact LRU of the last 4,096 hashes plus a fixed 256 KiB Bloom filter (7 hashes) of every hash in the session. A replay is rejected however old; memory is constant; a Bloom false positive only rejects a fresh frame | `test_replayed_frame_after_window_eviction_is_duplicate`, `test_seen_frames_is_bounded_and_never_forgets_within_a_session` |
| 3 | Empty references came from an earlier dataset's TEST directory | Reference split in the v2 dataset; `ReferenceProvenance` per capture; `EmptyReference.from_provenance` refuses TEST (or any non reference/calibration/dev) split, wrong image hash, wrong camera or calibration | `test_reference_from_test_split_is_rejected`, `test_reference_provenance_is_checked_and_hashed` |
| 4 | Seal bound only rule + manifest | `FROZEN_POLICY.json` binds code, dataset (manifest, labels, images, config), checkpoint, references (metadata + aggregate), DEV detection and feature caches, policy; `TEST_SEAL.json` binds the TEST caches; every TEST step re-verifies | `experiments/a2-bay-tracking/tests/test_seal.py` (code, references, checkpoint, detector cache, feature cache, dataset, policy) |
| 5 | Capture timestamps need not increase | Within a session `captured_at` must strictly increase: an equal or earlier timestamp is `non_monotonic_timestamp`, rejected, and the readiness window and tracks are reset. seq must strictly increase (`out_of_order_frame`, rejected, window kept) | `test_backward_timestamp_is_rejected_and_resets`, `test_equal_seq_is_out_of_order` |
| 6 | Documentation blurred claims | `docs/a2-open-evidence.md` now carries a corrections box: effective radius ~300 px, iteration sizes (1,728 then 2,304), OCCUPIED false positives measured as 24% own-bay transitions and 76% settled bays | — |

Replay behaviour is unchanged otherwise: a duplicate is rejected, never counted and never itself
ready; the window is kept (the existing v1 tests still pass unmodified).

## 2. Tracking model (`evidence/tracking.py`)

No new model. Tracks are built from the production A2 detector's boxes on consecutive accepted
frames of one session, in image pixels. Each track keeps `track_id`, class, confidence, box,
centroid, previous centroids, anchor (bottom centre of the box, the ground contact), velocity,
age, missed-frame count, last timestamp and last seq (`Track.to_dict`).

**Association** is deterministic and greedy:

1. Every live track predicts its box at the new timestamp from its velocity (two observations
   suffice for prediction).
2. A (track, detection) pair is a candidate when the labels are compatible (equal by default; a
   class change starts a new track and the old one is lost) and either IoU(predicted, detection)
   ≥ 0.3 or the anchor distance ≤ gate = max(60 px, 1.0 × predicted box diagonal).
3. Cost = (1 − IoU) + distance / gate. Candidates are taken in order of (cost, track id,
   detection index), each track and detection at most once.
4. A match is **ambiguous** when another candidate for the same track or detection lies within
   0.1 of its cost. Both tracks are then treated as unknown motion.

Unmatched detections start tracks; unmatched tracks are **lost** for up to 2 frames, then deleted.
Missing tracks are never read as "gone": see track loss below.

## 3. Approach-vector math

Per (track, bay), with the bay target point T = polygon centroid and anchor P:

- velocity v = (P_now − P_k) / (t_now − t_k) over the last 2 observations (needs ≥ 3);
- d = T − P; cos = v·d / (|v||d|);
- closing = dist(P_k, polygon) − dist(P_now, polygon);
- path: P + v·τ for τ ∈ [0, horizon] intersects the polygon grown by `path_margin_px`; the first
  intersection gives the projected time-to-bay (ttb);
- gap = distance from the track's box to the polygon.

**approaching** = history ≥ 3 ∧ |v| ≥ speed floor ∧ closing ≥ 3 px ∧ cos ≥ min_cos ∧ path hits the
bay within the horizon. A vehicle driving along the aisle has a path parallel to the bay row, so
it does not approach the bays it passes; a vehicle turning toward a bay does.

## 4. Bay-specific transition state

Per bay and frame, the most conservative of its tracks' states:

| State | When | Blocks |
|---|---|---|
| approaching | as above | yes |
| departing | the track's box covered ≥ 10% of the bay at some point and it is not closing | yes |
| ambiguous | young track (< 3 observations) or ambiguous association within `uncertain_near_px`; moving within `near_px` and not clearly receding; stopped within `near_px` after moving (paused) and not parked in another bay; within the approach latch (below) | yes |
| lost | a track unmatched this frame within `uncertain_near_px`; or a deleted track's last box was that close, for `lost_cooldown_ms` | yes |
| settled | no blocking track (unrelated motion elsewhere, stationary parked vehicles, vehicles passing beyond `near_px`) | no |

Bay-local signals from the coarse gate remain in tracking mode: a partial detection overlap of the
bay or an appearance change of the bay interior marks it `suspected`. Only the any-motion-within-
radius veto is replaced. The coarse gate remains available as the baseline (`tracking=None`).

**Approach latch.** Once a track has approached a bay, that bay stays `ambiguous` for
`approach_latch_ms` (1.5 s) and for as long as the track stays within `uncertain_near_px`. This
was added during unit testing: without it, a car backing out of an aborted approach left the bay
"settled" while still ~54 px away.

**Departing** blocks while the vehicle leaves; afterwards the readiness window (all frames
passing every gate, transition settled throughout) is what re-establishes positive empty evidence.

## 5. Lost-track safety

A lost track never clears a bay. While unmatched (≤ `max_missed` frames) it blocks bays within
`uncertain_near_px` of its last box. After deletion, with `lost_cooldown_ms` > 0 (policy D), those
bays stay blocked for the cooldown. A new track appearing next to a bay is young, so it is
ambiguous until it has history. Detector outages are tested by the `detector_dropout` family
(detections removed for 2 frames around the approach) and occlusion by `occluded_approach` (a
tall screen in front of the approach path).

## 6. Reference provenance

`experiments/a2-bay-tracking/references.py` uses only the reference split: 12 single calibration
captures (one empty lot and two partly occupied lots per lighting preset). A bay is designated
empty in a capture when its reference label says empty, no footprint reaches into it and no
vehicle box covers it (the operator-confirmation stand-in). Each capture records camera_id,
calibration_version, source split, category, image SHA-256, source id, creation method and
designated bays. Every bay has 5–9 reference patches. The aggregate provenance SHA-256 is bound by
the seal. No DEV or TEST image builds or selects references.

## 7. Stronger seal

See the table in section 1. Order enforced by `seal.py`, `infer.py` and `evaluate.py`:

1. DEV inference, DEV features, DEV selection (`DEV_SELECTION.json`).
2. `evaluate.py freeze` writes `FROZEN_POLICY.json` (refuses to overwrite) with the git commit,
   policy, evidence and tracking configs and every binding; it is committed before step 3.
3. `infer.py --split test` verifies every binding, then caches TEST detections.
4. `evaluate.py features --split test` verifies again, computes TEST features, writes
   `TEST_SEAL.json` (TEST cache hashes; refuses to overwrite).
5. `evaluate.py test` verifies the frozen bindings and the TEST seal, runs once, writes
   `RESULTS_TEST.json`, and refuses a second run.

## 8. Dataset `a2-temporal-v2-ac0f55eabd`

Config `experiments/a2-bay-tracking/configs/a2-temporal-v2.json` (dataset seed 2026102101), planner
`apps/simulator/src/dataset/temporalV2.ts`. Rendered through the production capture path at commit
`d11380c` with a clean tree (`git_dirty: false`); a second render was byte-identical.

- **2,316 images (277 MB):** 1,152 DEV, 1,152 TEST, 12 reference. 72 sequences per split × 16
  frames at 500 ms; 13,824 space observations per split (DEV 7,739 empty / 6,085 occupied;
  TEST 7,598 / 6,226).
- **Motion is scripted, not teleported.** Every moving vehicle follows a deterministic path:
  drive in from beyond the lot edge, curve into a bay along World's own arrival curve, back out
  and drive off, drive past, pause in front of a bay, or start toward a bay and abort. Parked
  vehicles come from World. Pixels, boxes and truth all follow from the same state. Every frame
  has a vehicle moving inside the visible lot, so consecutive frames always differ.
- **18 families**, each in all four lighting presets in each split: settled empty / sparse /
  medium / dense / full, entering, exiting, aborted approach, pass-by, neighbour-bay approach (both
  neighbours empty), two vehicles crossing to opposite bays, pause near a bay, detector dropout
  (detections removed for 2 frames around the approach), occluded approach (a 3.2 × 4.5 m screen
  in front of the approach path), partial occlusion (crate), severe occlusion (tall pillars),
  pickups and vans, row patterns.
- **Labels per bay and frame:** truth (vehicle centre inside), phase (settled, entering, exiting,
  approaching, aborting, paused_near), footprint intrusion (a vehicle's body reaches into the bay)
  and occupied-within-2 s; role (target, neighbour, other).
- **Splits** by scene seed. DEV seeds 236038274, 1309460116; TEST 235545405, 1310100080; reference
  1309607211. None appears in the A2 training dataset (`a2-sim-v1`) or in temporal v1 DEV/TEST
  (checked by the validator and the planner test).
- **Validation** (`validate_temporal_v2.py`): 24/24 checks pass, including image and label
  checksums, strict ordering of index/capture time/seq, no repeated image anywhere (including
  references), no seed/sequence leakage, scenario semantics (targets go empty→occupied or the
  reverse, aborted and paused targets are never occupied, neighbours empty, dropout only where
  designed), family × environment, density, phase, vehicle and row-pattern coverage per split,
  production `FrameMetadata` contract, and a byte-identical plan-only re-generation.

## 9. DEV selection

DEV only; TEST was not inferred, featurized or read until the freeze commit existed. Surface
thresholds are the v1 frozen values for every policy (reference match ≥ 0.95, markings ≥ 0.6,
clutter ≤ 0.05, appearance change ≤ 0.02, vehicle overlap 0), so the policies differ only in
transition handling. Selection rule, committed with the harness before any DEV run: zero DEV false
OPEN and zero DEV transition hazard, every one-step-looser grid neighbour also zero on both,
maximise DEV recall, ties to the strictest.

A **transition hazard** is a ready bay that is truth-empty but entering, exiting, approached,
aborting, paused at, intruded by a vehicle's footprint, or occupied within 2 s. A **false OPEN** is
a ready bay that is truth-occupied.

**Iteration 1** (anchor-ray path, 729 combinations, horizon fixed at 3 s): **0 safe.** Every
tracking policy had zero false OPEN. The best had 2 hazards, both cars still driving straight along
the aisle toward the bay they were about to turn into: the anchor ray runs parallel to the row and
never enters the bay. Kept as `DEV_SELECTION.iter1.json`.

**Iteration 2** (library change: swept-box path, lost tracks extrapolated along their last
velocity; horizon added; path margins 40 and 60 px added after a DEV spot check showed row-B
entrances ~35 px below a car's box in the aisle centre lane): **1,944 combinations, 612 safe, 144
eligible with margin.** Path margins of 10 and 20 px were never safe; window 2 was never safe; the
lost-track cooldown did not change safety on DEV.

**Selected and frozen** (`FROZEN_POLICY.json`, policy SHA-256 `43fff16c378b…`, code commit
`9f766fe`, freeze commit `d9e427a`): tracking gate, speed floor 40 px/s, path margin 60 px,
horizon 3 s, near 25 px, uncertain-track radius 30 px, approach latch 1.5 s, no lost-track
cooldown, window 5.

**Policy comparison on DEV** (open_ready / false OPEN / hazard / recall among empty / coverage of
all observations):

| Policy | Window 5 | Window 3 | Window 2 | Window 1 |
|---|---|---|---|---|
| A coarse, frozen v1 as executed (~300 px) | 28 / 0 / 0 / 0.36% / 0.20% | 114 / 0 / 0 / 1.47% / 0.82% | 222 / 0 / 0 / 2.87% / 1.61% | 330 / 0 / **1** / 4.26% / 2.39% |
| B coarse, corrected 360 px | 14 / 0 / 0 / 0.18% / 0.10% | 56 / 0 / 0 / 0.72% / 0.41% | 128 / 0 / 0 / 1.65% / 0.93% | 204 / 0 / 0 / 2.64% / 1.48% |
| C tracking, no cooldown (selected) | **141 / 0 / 0 / 1.82% / 1.02%** | 306 / 0 / 0 / 3.95% / 2.21% | 578 / 0 / **3** / 7.47% / 4.18% | 751 / 0 / **3** / 9.70% / 5.43% |
| D tracking + 3 s lost-track cooldown | 114 / 0 / 0 / 1.47% / 0.82% | 219 / 0 / 0 / 2.83% / 1.58% | 429 / 0 / **3** / 5.54% / 3.10% | 526 / 0 / **3** / 6.80% / 3.81% |

E (temporal confirmation) is the window columns: windows 3 and 5 are safe on DEV for C and D;
windows 1 and 2 are not. Fixing the radius bug makes the coarse gate *worse* (B < A), since it
now really vetoes everything within 360 px. Tracking at window 5 roughly quintuples A's coverage
and is about 2× the v1 sealed TEST coverage (0.52%), still small in absolute terms.

Selected policy at window 5 on DEV, readiness by slice (ready count, recall among empty): clear day
89 (4.3%), overcast 33 (1.7%), night 19 (1.0%), dusk 0; empty lot 2.99%, sparse 2.17%, medium 1.26%,
dense and full 0; near row B 3.39%, far row A 0.21%; **target and neighbour bays of an
approach 0**. Among blocked empty bays, transition reasons: approaching 41%, ambiguous 20%,
departing 14%, lost 9%, unknown 7%, suspected 5%.

## 10. TEST protocol and results

Protocol as in section 7. Freeze commit `d9e427a` preceded TEST inference; `TEST_SEAL.json` binds
the TEST caches (detections `a5f7934d…`, features `360cda46…`). `evaluate.py test` re-verified every
binding and wrote `RESULTS_TEST.json` once; a second run is refused.

1,152 frames, 13,824 space observations (7,598 truth-empty, 6,226 truth-occupied).

| Window | open_ready | False OPEN | False-OPEN rate | Hazards | Precision | Recall | Coverage | UNCERTAIN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **5 (frozen)** | **111** | **0** | **0.00%** | **0** | **1.000** | **1.46%** | **0.80%** | 51.0% |
| 3 | 243 | 0 | 0.00% | 0 | 1.000 | 3.20% | 1.76% | 50.1% |
| 2 | 470 | 0 | 0.00% | **1** | 1.000 | 6.19% | 3.40% | 48.4% |
| 1 | 625 | 0 | 0.00% | **1** | 1.000 | 8.23% | 4.52% | 47.3% |

**Every unsafe case, all windows:** no false OPEN at any window. One transition hazard, at windows
1 and 2 only: `t1310100080-row-0-night-f01`, bay A1, truth empty, phase entering, occupied within
2 s, bay motion settled (row-pattern family, night; frame 1 of the sequence, before any track had
history). Windows 3 and 5 had none, as DEV predicted (window 2 was never safe on DEV).

**Window-5 slices** (ready / recall among empty; zero false OPEN and zero hazards in every slice):

- Environment: overcast 52 / 2.53%, night 37 / 1.87%, clear day 22 / 1.27%, **dusk 0**.
- Density: empty 26 / 3.39%, sparse 60 / 2.07%, medium 25 / 0.79%, **dense 0, full 0**.
- Row: near (B) 95 / 2.50%, far (A) 16 / 0.42%.
- State: settled 111 / 1.52%, transition 0.
- Cases: pass-by sequences 3 / 0.57%; neighbour bays of an approach **0** (128 obs); approach
  targets 0; track-loss families 21 / 2.46% overall but **0** on their target and neighbour bays
  (320 obs); detector-dropout frames 2 / 3.45%; aborted and paused targets 0; two vehicles
  3 / 0.59%.
- Families: settled empty 26, entering 17 (bays away from the target), occluded approach 14,
  settled sparse 12, settled medium 7, pause near 7, detector dropout 7, exiting 5, others ≤ 3;
  large vehicles, settled dense and settled full 0.

Blocked empty bays at window 5 (multi-label): transition 95.7%, temporal 79.8%, vehicle 52.7%,
occlusion 23.4%, surface 21.6%, visibility 14.7%, frame 0.6%. Transition reasons: approaching
39.9%, ambiguous 17.4%, departing 14.5%, lost 10.6%, suspected 6.7%, unknown 6.6%.

**Production OCCUPIED** (unchanged rule) on these frames: precision 0.919, recall 0.983.

A2 CPU latency over the 1,152 TEST frames: mean 2.08 s, median 1.73 s, p95 5.37 s, measured
while macOS indexing drove the load average above 200 for part of the run. GPU latency is still
unmeasured.

## 11. Limitations

Simulator results cannot show real-world safety:

- **Deterministic rendering and static surfaces.** The deck is pixel-identical across frames and
  seeds, so an empty bay matches its reference almost perfectly. Real pavement, weather, wet
  patches, dirt, shadows and exposure drift will lower matches.
- **Limited sensor noise.** No compression artefacts beyond JPEG, no rolling shutter, blur, rain,
  glare or low-light noise.
- **Perfect calibration stability.** The camera never moves; real mounts drift and vibrate.
- **Synthetic occlusions.** Boxes, pillars and one screen; no pedestrians, trolleys or partial
  vehicle occluders of real shapes.
- **Synthetic motion.** Constant-speed scripted paths; no hesitations of real drivers, no
  reversing manoeuvres beyond one aborted approach, no pedestrians.
- **Detector dropout is injected**, not measured from real failures.
- **Frames are not independent observations.** Distinct frames come from scripted motion, not
  sensor noise.

## 12. Conclusion: INSUFFICIENT_EVIDENCE

What improved: transition gating is now per bay. Unrelated motion no longer vetoes everything
within a radius, readiness coverage at window 5 is about 4× the coarse gate as actually
executed on the same DEV data (1.02% vs 0.20%) and above v1's sealed coverage, and the sealed TEST
had zero false OPEN and zero hazards at the frozen window. The audit's seal, replay, timestamp,
radius and reference-provenance defects are fixed and tested.

Why it is still not enough:

1. **Coverage is ~1%.** A driver would almost never see OPEN. Approaching (40%), ambiguous (17%)
   and departing (15%) vehicle states block most empty bays, because every sequence contains
   moving vehicles by design.
2. **Safety comes from conservative reach, not discrimination.** The frozen policy needed a 60 px
   path margin and a 3 s horizon: every bay a vehicle's body could pass within 3 s is blocked. A
   car driving toward the bay it will turn into is still indistinguishable from a pass-by until it
   turns; the policy is safe because it blocks both. Neighbour bays of an approach were never
   ready (0 of 128 TEST observations), so the "localised" benefit did not materialise there.
3. **Short windows are unsafe.** Windows 1–2 produced hazards on DEV and TEST (first frames of a
   sequence, before tracks have history).
4. **Dusk, dense and full lots get no readiness at all**, and far row A only 0.42%.
5. **Zero failures in 6,226 occupied TEST observations** bounds the false-OPEN rate below about
   0.048% (95%, rule of three), in simulation only.
6. **Simulation limitations** (section 11) make every number optimistic, the empty-reference match
   most of all.

## 13. What remains before OPEN could even be considered

- A sealed **real-camera temporal dataset** (real drivers, pedestrians, weather, night, sensor
  noise, camera drift), with DEV/TEST by day or site and a pre-registered protocol like this one.
- A **real empty-reference procedure**: operator-confirmed captures per lighting regime, drift
  detection and refresh rules, provenance as implemented here.
- Better motion evidence than a swept box: turn/heading cues, lane geometry of the aisle, and
  multi-hypothesis association so a passing car can be told apart from one about to turn.
- A safety case with an explicit risk target, independent review, and a staged rollout (shadow
  mode, never shown to drivers, comparing against ground truth on real sites).
- GPU latency measurement and end-to-end freshness guarantees.

OPEN REMAINS DISABLED.

## Reproduce

```sh
node scripts/dataset/generate.mjs --config experiments/a2-bay-tracking/configs/a2-temporal-v2.json
python experiments/a2-bay-tracking/validate_temporal_v2.py
python experiments/a2-bay-tracking/references.py
python experiments/a2-bay-tracking/infer.py --split dev
python experiments/a2-bay-tracking/evaluate.py features --split dev
python experiments/a2-bay-tracking/evaluate.py dev        # ~75 min on 7 workers
# Already done and committed: freeze, TEST inference, TEST seal and the single TEST run.
```
