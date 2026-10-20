# A2 OPEN safety evaluation

## Decision

**INSUFFICIENT_EVIDENCE**

Do not enable OPEN in production. The current conservative behavior remains justified.

Naive absence produced 22 false OPENs on the frozen TEST split. Applying the existing low-floor ambiguity guard reduced this to one false OPEN, but did not reach the safety gate. An `any_overlap_veto` reached zero false OPENs on these samples, including the robustness subset and captured demo scenes, but its safety margin rests on tiny incidental box/ROI intersections rather than positive empty-space evidence. A2 has no output for space visibility, occlusion risk, or transition state, and the frozen TEST split cannot evaluate 3- or 5-frame confirmation.

The smallest next engineering change is to add a camera-specific positive empty-space/visibility signal with explicit occlusion and transition gating, then collect a newly sealed held-out dataset containing at least five genuine consecutive frames per settled and transition scene. That change must be evaluated before any production `allow_open` change.

## Isolation and immutable inputs

- Branch: `feat/a2-open-evaluation`
- Worktree: `~/Desktop/parkright-worktrees/a2-open-evaluation`
- Base: `integration/a2-nemotron-demo` at `a696787`
- Frozen checkpoint: `~/.cache/parkright/models/a2-fasterrcnn/best.pt`
- Checkpoint SHA-256: `43452092f0597922badc038c618dd5c76afc27d98be21688a2878f28b1c24985` (verified)
- Dataset: `a2-sim-v1-b569da957c`
- Manifest SHA-256: `935f4108f4b1e00c17f71b090ac60f4ad38c86e1ec183b10bef121f2a4e976c3` (verified)
- Calibration: `cam-01-fixed-v1`, SHA-256 `50b7bcc93de01e2c9e501ee607d477396116644cf20d504951725f1273d3245d` (verified)
- TEST size: 284 images / 3,408 space observations
- Standard: 204 images / 2,448 space observations
- Robustness: 80 images / 960 space observations
- No training or TEST-driven threshold tuning was performed.
- No production provider, `allow_open`, threshold, calibration, API state-machine, simulator truth isolation, Nemotron, or shared-contract file was changed.

The evaluation calls the frozen production `FasterRCNNA2` detector and reproduces the production space mapping geometry and frame/ROI quality checks. It evaluates hypothetical states only in this experiment.

## Metric definitions

A false OPEN is an `OPEN` decision for a truth-`occupied` space. Its rate denominator is all truth-`occupied` space observations. OPEN precision and recall treat truth-`empty` as the positive class. OCCUPIED precision/recall use truth-`occupied`. `UNCERTAIN %` is the abstention percentage. Policy accuracy is the fraction of all observations receiving a correct explicit decision (`OPEN` for empty or `OCCUPIED` for occupied); `UNCERTAIN` is not counted as correct.

`null` OPEN precision means the policy issued no OPEN decisions.

## Fixed candidate policies

The thresholds were specified from existing production semantics before this per-space run:

- `current`: OCCUPIED at confidence >= 0.65 and ROI coverage >= 0.45; otherwise UNCERTAIN. OPEN disabled.
- `naive_absence`: the current OCCUPIED gate; otherwise OPEN after existing frame and ROI quality checks.
- `low_floor_space_veto`: naive absence, but abstain when any A2 detection has confidence >= 0.05 and ROI coverage >= 0.02.
- `any_overlap_veto`: naive absence, but abstain when any A2 detection at the 0.05 model floor intersects the ROI at all.
- `whole_frame_clear`: OPEN only when the valid frame contains no A2 detection anywhere.
- `temporal_2`, `temporal_3`, `temporal_5`: require that many adjacent `low_floor_space_veto` OPEN candidates in a genuine same-scene sequence. OCCUPIED evidence still wins immediately.
- `oracle_context_gate`: TEST-only diagnostic using scenario transition/occluder labels. It is not deployable and is not a recommendation.

## Overall held-out TEST results

| Policy | OPEN P | OPEN R | False OPEN | False OPEN rate | OCC P | OCC R | UNCERTAIN | Policy acc. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| current | n/a | 0.0000 | 0 | 0.0000% | 0.9603 | 0.9877 | 46.10% | 0.5176 |
| naive absence | 0.9841 | 0.8409 | 22 | 1.2318% | 0.9603 | 0.9877 | 5.43% | 0.9178 |
| low-floor space veto | 0.9991 | 0.6486 | 1 | 0.0560% | 0.9603 | 0.9877 | 15.20% | 0.8263 |
| any-overlap veto | 1.0000 | 0.5475 | 0 | 0.0000% | 0.9603 | 0.9877 | 20.04% | 0.7782 |
| whole-frame clear | 1.0000 | 0.0222 | 0 | 0.0000% | 0.9603 | 0.9877 | 45.04% | 0.5282 |
| oracle context gate (not deployable) | 1.0000 | 0.4593 | 0 | 0.0000% | 0.9603 | 0.9877 | 24.24% | 0.7362 |
| temporal 2 | 1.0000 | 0.0481 | 0 | 0.0000% | 0.9603 | 0.9877 | 43.81% | 0.5405 |
| temporal 3 | n/a | 0.0000 | 0 | 0.0000% | 0.9603 | 0.9877 | 46.10% | 0.5176 |
| temporal 5 | n/a | 0.0000 | 0 | 0.0000% | 0.9603 | 0.9877 | 46.10% | 0.5176 |

The zero-false-OPEN result for `any_overlap_veto` is not sufficient evidence for production. Its two critical catches depend on overlaps of only 0.8812% on TEST and 0.0158% in the captured occlusion demo. Small calibration, pose, or box changes could remove those incidental intersections, and a complete detector miss still becomes OPEN.

## Standard and robustness split

| Split / policy | OPEN P | OPEN R | False OPEN | False OPEN rate | OCC P | OCC R | UNCERTAIN | Policy acc. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Standard / naive | 0.9923 | 0.8296 | 8 | 0.6612% | 0.9435 | 0.9934 | 5.68% | 0.9105 |
| Standard / low-floor | 1.0000 | 0.6341 | 0 | 0.0000% | 0.9435 | 0.9934 | 15.89% | 0.8117 |
| Standard / any-overlap | 1.0000 | 0.5477 | 0 | 0.0000% | 0.9435 | 0.9934 | 20.26% | 0.7680 |
| Robustness / naive | 0.9601 | 0.8776 | 14 | 2.4306% | 0.9982 | 0.9757 | 4.79% | 0.9365 |
| Robustness / low-floor | 0.9963 | 0.6953 | 1 | 0.1736% | 0.9982 | 0.9757 | 13.44% | 0.8635 |
| Robustness / any-overlap | 1.0000 | 0.5469 | 0 | 0.0000% | 0.9982 | 0.9757 | 19.48% | 0.8042 |

### Robustness-family results

| Family / policy | OPEN P | OPEN R | False OPEN | False OPEN rate | OCC P | OCC R | UNCERTAIN | Policy acc. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Tall pillar / low-floor | 0.9861 | 0.5917 | 1 | 0.5952% | 0.9935 | 0.9167 | 21.18% | 0.7812 |
| Tall pillar / any-overlap | 1.0000 | 0.4583 | 0 | 0.0000% | 0.9935 | 0.9167 | 27.08% | 0.7257 |
| Pickup/van / low-floor | 1.0000 | 0.5750 | 0 | 0.0000% | 1.0000 | 1.0000 | 13.28% | 0.8672 |
| Pickup/van / any-overlap | 1.0000 | 0.4167 | 0 | 0.0000% | 1.0000 | 1.0000 | 18.23% | 0.8177 |
| Row pattern / low-floor | 1.0000 | 0.8819 | 0 | 0.0000% | 1.0000 | 1.0000 | 5.90% | 0.9410 |
| Row pattern / any-overlap | 1.0000 | 0.7292 | 0 | 0.0000% | 1.0000 | 1.0000 | 13.54% | 0.8646 |
| Standard occlusion / low-floor | 1.0000 | 0.3889 | 0 | 0.0000% | 0.8444 | 1.0000 | 23.33% | 0.6792 |
| Standard occlusion / any-overlap | 1.0000 | 0.3095 | 0 | 0.0000% | 0.8444 | 1.0000 | 27.50% | 0.6375 |

Pickup truth observations had OCCUPIED recall 1.0000 for all policies. Van truth observations had OCCUPIED recall 0.9912; naive absence converted two missed van observations to false OPEN, low-floor converted one to false OPEN, and any-overlap abstained on both. Row-pattern subfamilies (`checkerboard`, `row_a_only`, `row_b_only`) had zero false OPENs under all evaluated policies; full subfamily metrics are in `RESULTS.json`.

## Any-overlap veto breakdown

This is the strongest non-oracle single-frame result, shown to make its zero-failure scope explicit.

| Dimension | Slice | OPEN P | OPEN R | False OPEN | OCC P | OCC R | UNCERTAIN | Policy acc. |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Environment | clear day | 1.0000 | 0.6527 | 0 | 0.9900 | 0.9822 | 17.28% | 0.8222 |
| Environment | overcast | 1.0000 | 0.7157 | 0 | 1.0000 | 1.0000 | 13.24% | 0.8676 |
| Environment | dusk | 1.0000 | 0.0727 | 0 | 0.8662 | 0.9875 | 35.35% | 0.5645 |
| Environment | night | 1.0000 | 0.6715 | 0 | 0.9865 | 0.9846 | 15.97% | 0.8333 |
| Density | empty | 1.0000 | 0.7500 | 0 | n/a | n/a | 25.00% | 0.7500 |
| Density | sparse | 1.0000 | 0.6426 | 0 | 0.6503 | 0.9636 | 22.92% | 0.6917 |
| Density | medium | 1.0000 | 0.5067 | 0 | 0.9819 | 0.9878 | 25.93% | 0.7322 |
| Density | dense | 1.0000 | 0.3761 | 0 | 0.9941 | 0.9853 | 15.78% | 0.8378 |
| Density | full | n/a | n/a | 0 | 1.0000 | 1.0000 | 0.00% | 1.0000 |
| State | settled | 1.0000 | 0.5347 | 0 | 0.9618 | 0.9911 | 19.88% | 0.7801 |
| State | transition | 1.0000 | 0.6119 | 0 | 0.9488 | 0.9623 | 21.04% | 0.7667 |
| Row | far (A) | 1.0000 | 0.6030 | 0 | 0.9549 | 0.9845 | 17.02% | 0.8052 |
| Row | near (B) | 1.0000 | 0.4933 | 0 | 0.9658 | 0.9909 | 23.06% | 0.7512 |

The JSON artifact contains the corresponding complete breakdown for every policy, including false-OPEN rates and robustness variants.

## Exact false OPEN cases

Naive absence had 22 false OPEN observations. Every case had a detection, but no detection met both the 0.65 confidence and 0.45 space-coverage gates.

| Scenario | Environment | Space | Context | Failure |
|---|---|---|---|---|
| `s1965260074-dep-0` | clear day | B4 | transition, dense | best qualifying box coverage 0.2689 < 0.45 |
| `s1965260074-dep-0` | night | B4 | transition, dense | best qualifying box coverage 0.2705 < 0.45 |
| `s138577790-arr-0` | clear day | B4 | transition, medium | best qualifying box coverage 0.4165 < 0.45 |
| `s138577790-arr-0` | night | B4 | transition, medium | best qualifying box coverage 0.4148 < 0.45 |
| `s138577790-dep-0` | clear day | B3 | transition, sparse | best qualifying box coverage 0.3337 < 0.45 |
| `s138577790-dep-0` | night | B3 | transition, sparse | best qualifying box coverage 0.3219 < 0.45 |
| `s1211506763-dep-0` | clear day | B5 | transition, sparse | best qualifying box coverage 0.2921 < 0.45 |
| `s1211506763-dep-0` | night | B5 | transition, sparse | best qualifying box coverage 0.2709 < 0.45 |
| `r2098512160-pil-1` | clear day | A4 | tall pillar, dense | best qualifying box coverage 0.3005 < 0.45 |
| `r2098512160-pil-1` | dusk | A4 | tall pillar, dense | best qualifying box coverage 0.3099 < 0.45 |
| `r2098512160-pil-1` | night | A4 | tall pillar, dense | best qualifying box coverage 0.3210 < 0.45 |
| `r2098365065-pil-0` | clear day | A2 | tall pillar, medium | best qualifying box coverage 0.0962 < 0.45 |
| `r2098365065-pil-0` | dusk | A2 | tall pillar, medium | all overlapping detections below 0.65 confidence |
| `r2098365065-pil-0` | night | A2 | tall pillar, medium | best qualifying box coverage 0.0974 < 0.45 |
| `r2098365065-pil-1` | clear day | A4 | tall pillar, dense | all overlapping detections below 0.65 confidence |
| `r2098365065-pil-1` | dusk | A4 | tall pillar, dense | best qualifying box coverage 0.1815 < 0.45 |
| `r2098365065-pil-1` | night | A4 | tall pillar, dense | best qualifying box coverage 0.1846 < 0.45 |
| `r2098857934-pil-0` | clear day | A6 | tall pillar, medium | best qualifying box coverage 0.2722 < 0.45 |
| `r2098857934-pil-0` | dusk | A6 | tall pillar, medium | best qualifying box coverage 0.2739 < 0.45 |
| `r2098857934-pil-0` | night | A6 | tall pillar, medium | best qualifying box coverage 0.2604 < 0.45 |
| `r1024943223-pil-0` | clear day | A6 | tall pillar, dense | best qualifying box coverage 0.0109 < 0.45 |
| `r1024943223-pil-0` | dusk | A6 | tall pillar, dense | best qualifying box coverage 0.0088 < 0.45 |

The sole `low_floor_space_veto` false OPEN is the final case: `r1024943223-pil-0-dusk`, A6, an occupied van in the far row. The high-confidence car box scored 0.999657 but intersected only 0.008812 of A6, below the 0.02 ambiguity-coverage gate. `any_overlap_veto` avoids this observed failure only because it treats that tiny intersection as a veto.

## Temporal consistency

The frozen TEST split has only two genuine same-lighting temporal positions per transition scenario (35% and 70% progress). Settled and robustness cases are single snapshots. Day/night variants were not misrepresented as consecutive frames.

| Policy / scope | OPEN P | OPEN R | False OPEN | OPEN decisions | UNCERTAIN |
|---|---:|---:|---:|---:|---:|
| 2-frame / all TEST | 1.0000 | 0.0481 | 0 | 78 | 43.81% |
| 2-frame / transition only | 1.0000 | 0.2910 | 0 | 78 | 38.96% |
| 3-frame / all TEST | n/a | 0.0000 | 0 | 0 | 46.10% |
| 5-frame / all TEST | n/a | 0.0000 | 0 | 0 | 46.10% |

The 2-frame result does not cover settled or robustness scenes and therefore does not validate a deployable temporal policy. The 3- and 5-frame candidates cannot be evaluated on TEST.

## Captured integrated demo replay

The exact captured images in the immutable `a2-evaluation/dataset.json` artifact were replayed through the frozen A2 detector: two seeds (`4242`, `777`), day/night, occupancy 0/4/10/12, one full occlusion scene, and one arrival-transition scene. The source artifact SHA-256 is `341dcd646bfc6ca5106e3cb502980e011aba1da1a4f6fbc221f695065ecf252c`; its scenario manifest SHA-256 is `f0f3a71c31f3ab45bfb7892bc36d0399db1b3b7fe43e4ce7d3452dd4d23b5e17`. The API state machine was not invoked or changed.

Across 18 frames / 216 spaces:

| Policy | OPEN P | OPEN R | False OPEN | False OPEN rate | OCC P | OCC R | UNCERTAIN |
|---|---:|---:|---:|---:|---:|---:|---:|
| naive absence | 0.9804 | 1.0000 | 2 | 1.7241% | 1.0000 | 0.9828 | 0.00% |
| low-floor veto | 0.9898 | 0.9700 | 1 | 0.8621% | 1.0000 | 0.9828 | 1.85% |
| any-overlap veto | 1.0000 | 0.9400 | 0 | 0.0000% | 1.0000 | 0.9828 | 3.70% |
| whole-frame clear | 1.0000 | 0.4800 | 0 | 0.0000% | 1.0000 | 0.9828 | 25.00% |

Both naive false OPENs are in `occlusion-full-day`: B3 and B4, both actually occupied. Low-floor blocks B3 but still false-opens B4. For B4, the strongest overlapping box scored 0.999697 but intersected just 0.000158 of the calibrated ROI. Any-overlap abstains because of that incidental intersection. The arrival snapshot issued no false OPEN because its only transitioning vehicle was still truth-empty at the captured time; it is not evidence about a later occupied transition.

The 1/2/5 Hz captured rate artifacts contain 15/15/17 repeated frames at one simulator time. Two-, three-, and five-frame confirmation produced zero false OPENs there, but these streams do not contain a changing state and therefore test persistence only, not transition safety.

## Visibility, occlusion, and completeness limits

- Detector completion and existing whole-frame/ROI brightness, contrast, dimension, and pixel-count validity were enforced.
- A2 emits vehicle boxes only. It cannot positively establish that the parking surface is visible.
- A2 emits no occlusion-risk estimate. Scenario occluder metadata is ground truth and cannot be used by production.
- A2 emits no transition state. Scenario transition metadata is ground truth and cannot be used by production.
- The zero-failure `oracle_context_gate` therefore does not describe an implementable policy.
- `whole_frame_clear` also had zero failures, but opened only 36 of 1,622 empty TEST observations (2.22% recall), all outside robustness cases. This is not useful evidence of safe per-space OPEN classification.

## Reproduction and tests

Run:

```bash
/Users/moody/Desktop/parkright-worktrees/perception-a2-finetune/.venv/bin/python \
  experiments/a2-open-evaluation/evaluate.py

PYTHONDONTWRITEBYTECODE=1 \
  /Users/moody/Desktop/parkright-worktrees/perception-a2-finetune/.venv/bin/python \
  -m pytest -q -p no:cacheprovider experiments/a2-open-evaluation/tests
```

Focused result: **8 passed**.

Fresh CPU inference latency for TEST (batch size 1): mean 1,471.5 ms, median 1,439.7 ms, p95 1,684.8 ms. Duplicate captured rate frames reused a detection cache and are not independent latency samples.

Machine-readable results, complete per-policy breakdowns, exact false-OPEN evidence, demo per-scene counts, artifact hashes, and evaluation limits are in `RESULTS.json`.
