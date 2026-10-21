# A2 bay-specific tracking (evaluation only)

**OPEN REMAINS DISABLED.** `allow_open` is false, production occupancy is OCCUPIED or UNCERTAIN,
and nothing in the production runtime imports the evidence or tracking code (pinned by tests,
including a subprocess check of `create_app`). Production perception (A0, A2 calibrated mapping)
and the Nemotron recommendation code are byte-identical to `integration/a2-nemotron-demo`
(`a696787`), pinned by file hashes in `test_bay_tracking.py`. Nothing here, including a clean
simulator TEST result, authorizes production OPEN.

Branch `feat/a2-bay-tracking`, based on `feat/a2-open-evidence` at `bb57eb9`.

<!-- RESULTS_SUMMARY -->

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

<!-- DATASET -->

## 9. DEV selection

<!-- DEV -->

## 10. TEST protocol and results

<!-- TEST -->

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

<!-- REMAINS -->
