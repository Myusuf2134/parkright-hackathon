# A0 — NVIDIA SSD visual baseline

Implemented on `feat/perception-a0`, based on backend foundation `e5cd87d`.
Production input is only `Frame(metadata, jpeg)` and `CameraView` static calibration.
No simulator, world, parking-state, or evaluation-store access. Contracts are unchanged.

## Model and reproducibility

REAL MODEL: NVIDIA SSD300 ResNet-50, COCO checkpoint **20.06.0**, FP32 PyTorch.
Source revision: `a6c678ef0323cdaae053e9eed34dce94488ad313`.
Checkpoint SHA256: `8167ab3781fde764796931c661629b166dd192eac81fcb846b0f4b474c8cc616`.
The adapter checks both; source checkout must be clean. Weights are loaded with
`weights_only=True`, on CPU first. No network download occurs during API startup or inference.
The lazy model constructor removes the official source's import-time pretrained
ResNet default argument in memory, then supplies `ResNet(weights=None)` and loads
all SSD parameters strictly. It does not modify the NVIDIA checkout.

Sources:
- [NVIDIA/PyTorch SSD model instructions](https://pytorch.org/hub/nvidia_deeplearningexamples_ssd/)
- [Pinned NVIDIA implementation](https://github.com/NVIDIA/DeepLearningExamples/tree/a6c678ef0323cdaae053e9eed34dce94488ad313/PyTorch/Detection/SSD)
- [NVIDIA NGC model and terms](https://catalog.ngc.nvidia.com/orgs/nvidia/models/ssd_pyt_ckpt_amp)
- [Machine-readable NVIDIA model card](https://api.ngc.nvidia.com/v2/models/nvidia/ssd_pyt_ckpt_amp)

NVIDIA source files carry Apache-2.0 notices. The NGC model card directs weight
users to the training-script and source-dataset terms; this report does **not**
relicense the checkpoint or claim all COCO images are Apache licensed. No NVIDIA
source, weights, or third-party sample photographs are redistributed in this branch.
Repository docs name NVIDIA/Nebius and A0–A3 but contain no detailed judging rules;
this implementation alone does not establish hackathon eligibility.

SSD was chosen as a small, directly available NVIDIA pretrained detector with a
working CPU path. TAO RT-DETR is a reasonable stronger alternative later, but its
runtime/export setup is heavier. This is NVIDIA model inference on CPU, not a claim
that a Mac has NVIDIA acceleration. CUDA is selectable but untested here.

## Algorithm and safety

1. Decode JPEG with bounded dimensions; reject corrupt, undersized, very dark,
   overexposed or nearly uniform input. Repeat brightness/contrast checks per ROI.
2. Resize the **whole frame** to 300×300 and normalize RGB to [-1,1]. Unlike the
   published example's center crop, this retains every camera ROI; aspect distortion
   is a known baseline limitation.
3. Run SSD; decode boxes and class probabilities; retain low-score candidates for
   ambiguity and apply class-wise NMS. Car=3, bus=6, truck=8 are **contiguous** COCO
   class IDs. SUVs/vans are covered only when recognized as car/truck; no dedicated
   SUV/van class is claimed. Other detected objects obstruct OPEN but cannot establish OCCUPIED.
4. Polygon intersection area / parking ROI area measures coverage. Each space is
   evaluated independently; one large vehicle can occupy multiple spaces.
5. Confidence ≥0.65 and coverage ≥0.45 → OCCUPIED with the vehicle model score.
   Coverage ≥0.02 and confidence ≥0.05 → ambiguous unless strong occupancy exists.
6. OPEN is **experimental and disabled by default**. When explicitly enabled,
   it requires no ambiguous object, good ROI quality, ≥16 SSD background anchors
   spanning all four ROI-bounds quadrants, and every selected background probability
   ≥0.995. Confidence is the minimum selected model background score, **not** 1 minus
   a missing detection. Background scores are not calibrated parking probabilities.
7. Everything else → UNCERTAIN/null confidence. Missing/invalid polygons do not
   inherit floor-plan geometry. Detector failures fail closed and are logged.

All numerical thresholds are in `A0Config` (`services/perception/.../a0/config.py`),
including NMS=0.5 and candidate floor=0.01. Enable experimental OPEN with a JSON file
containing `{"allow_open": true}` via `PARKRIGHT_A0_CONFIG`; evaluate false-OPEN risk
on the intended camera first. Production registry has `none` and `a0`; no stub
provider can be selected there. Unit doubles identify themselves as **TEST STUB**
and receive separate provenance.

ModelRef.provider is `a0-nvidia-ssd300`; version is an algorithm-version-prefixed
hash of source/weights/runtime/device identity and complete threshold config.
`benchmark.py` records the full mapping. Existing normalization supplies the frame,
camera and model fields to every observation. Change the algorithm version when
changing semantics. The API remains GPU-independent and defaults to `none`.
Inference runs in a worker thread with a lock; timeout does not kill a running
PyTorch call. Frame ordering and timeout behavior remain owned by the existing API.

## Install and run

From this worktree root (Python 3.12):

```sh
uv venv /tmp/parkright-a0-env
uv pip install --python /tmp/parkright-a0-env/bin/python \
  'torch>=2.6,<3' 'torchvision>=0.21,<1' 'numpy>=2,<3' 'pillow>=12,<13' \
  'shapely>=2,<3' pydantic pydantic-settings fastapi python-multipart uvicorn \
  pytest httpx websockets ruff mypy
export A0_PYTHON=/tmp/parkright-a0-env/bin/python

git clone https://github.com/NVIDIA/DeepLearningExamples.git /tmp/parkright-nvidia-ssd
git -C /tmp/parkright-nvidia-ssd checkout a6c678ef0323cdaae053e9eed34dce94488ad313
curl -L --fail https://api.ngc.nvidia.com/v2/models/nvidia/ssd_pyt_ckpt_amp/versions/20.06.0/files/nvidia_ssdpyt_amp_200703.pt \
  -o /tmp/parkright-nvidia-ssd.pt
export PARKRIGHT_A0_SOURCE=/tmp/parkright-nvidia-ssd
export PARKRIGHT_A0_WEIGHTS=/tmp/parkright-nvidia-ssd.pt
export PARKRIGHT_A0_DEVICE=cpu
export PARKRIGHT_PERCEPTION_PROVIDER=a0
experiments/a0-baseline/run.sh -m parkright_api
```

Use a compatible CUDA PyTorch installation and `PARKRIGHT_A0_DEVICE=cuda` on Nebius;
no deployment or GPU performance is claimed. Source packages are exposed by run.sh
without changing the shared workspace lock. The perception package declares its
runtime dependencies and optional `ssd` extra. Root `uv.lock` is intentionally not
edited within this ownership scope; the integration owner should regenerate it
when combining branches. Exact locally measured versions are in `environment.txt`.

The supplied facility watches A1–A6/B1–B6 but has **no calibrated camera polygons**.
Provide a production facility JSON through `PARKRIGHT_FACILITY_FIXTURES='["/absolute/facility.json"]'`.
Populate `cameras[].polygons` with normalized camera-image coordinates. Never copy
`spaces[].plan` into these fields. `geometry-test-only.json` is an explicit artificial
12-ROI test fixture; it is not the simulator camera's calibration or a parking dataset.

## Tests, benchmark, evaluation

```sh
experiments/a0-baseline/run.sh -m pytest
PYTHONPATH=experiments/a0-baseline "$A0_PYTHON" -m pytest experiments/a0-baseline/test_score.py
PARKRIGHT_A0_REAL_SMOKE=1 experiments/a0-baseline/run.sh -m pytest services/perception/tests/test_a0.py -k real_model
"$(dirname "$A0_PYTHON")/ruff" check services/perception/src/parkright_perception/a0 services/perception/tests/test_a0.py experiments/a0-baseline
experiments/a0-baseline/run.sh -m mypy --ignore-missing-imports services/perception/src/parkright_perception/a0
npm ci --ignore-scripts
npm run typecheck
npm run build -w @parkright/web

# Supply a legally usable camera JPEG, or temporary public smoke image:
curl -L --fail https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg -o /tmp/a0-bus.jpg
experiments/a0-baseline/run.sh experiments/a0-baseline/benchmark.py /tmp/a0-bus.jpg \
  --facility experiments/a0-baseline/geometry-test-only.json --runs 10
experiments/a0-baseline/run.sh experiments/a0-baseline/score.py /path/to/offline-export.json
```

Normal tests require no weights/network. Real smoke explicitly requires artifacts;
missing weights never cause a stub fallback. Tests cover corrupted/poor JPEGs,
empty detections, strong/weak/outside/multiple/spanning vehicles, other classes,
low/invalid scores, missing calibration, all canonical states, OPEN evidence and
configuration, 12 outputs, provenance, detector failure and real API/WebSocket updates.
Existing tests enforce production/evaluation isolation and skipped-output normalization.

Offline score.py joins canonical observation and ground-truth exports on exact
camera/session/frame/space identity. Missing predictions count as UNCERTAIN;
duplicates are rejected, unmatched predictions counted, undefined denominators
reported as null. Reports overall accuracy, both class precision/recall, UNCERTAIN
rate, confusion matrix, and prominently false-OPEN count/rate. It is outside the
production package and never feeds labels into inference. No labeled parking data
exists here, so **no parking accuracy or false-OPEN performance is claimed**.

## Measured results and limits

See `benchmark-cpu.json` for cold/warm timing, full provenance and 12-ROI outputs.
Input is a public bus photograph and artificial geometry, not 12 parking spaces.
It validates computation only. The raw model detected a bus at 0.974081 confidence.
The normal garage remains all UNCERTAIN until legitimate camera calibration exists.

Browser check: facility selection, virtual-environment label, 12 uncertain spaces,
no availability offered, and conservative reconnect state verified in native Chrome.
A real JPEG POST returned 202 and 12 A0 observations. Automated integration verifies
frame → provider → occupancy → WebSocket. No GPU compilation or validation performed.

Small distant vehicles, occlusion, perspective, domain shift to rendered cars,
darkness and glare can defeat SSD. Quality heuristics cannot prove visibility.
OPEN background evidence needs evaluation before deployment. Neither geometry-test
outputs nor neutral-image tests are accuracy evidence. No A1–A3 work is included.

Final measured CPU run (10 warm frames): mean decode 5.95 ms, inference 180.46 ms,
ROI postprocessing 17.01 ms, total 203.43 ms; total p95 275.45 ms. Cold frame 2.965 s.
This is approximately 4.9 FPS sequential warm throughput on this sample, not a
sustained 5 FPS service guarantee. Download/startup validation and HTTP queueing
are outside frame timings; lazy model loading is included in the cold frame.

Validation: 135 backend tests passed with real-model smoke enabled; 2 separate
scoring tests passed. A0 Ruff lint, Python mypy check, frontend typecheck, generated
contract drift check and web production build passed. No files in simulator,
contracts, or API were changed relative to the original foundation commit.
