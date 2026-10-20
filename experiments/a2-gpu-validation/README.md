# Frozen A2 NVIDIA GPU validation

Status: **package prepared; GPU execution blocked by unavailable configured GPU access**.
No infrastructure was provisioned, no model retrained, and no production behavior changed.

## Frozen inputs

- Parent branch tip: `95f177adf97239bcb7c107220cbb13440e84be46`.
- Checkpoint: `best.pt`, SHA-256 `43452092f0597922badc038c618dd5c76afc27d98be21688a2878f28b1c24985`, 173396489 bytes.
- Dataset: `a2-sim-v1-b569da957c`; manifest SHA-256 `935f4108f4b1e00c17f71b090ac60f4ad38c86e1ec183b10bef121f2a4e976c3`.
- Config canonical SHA-256 `7f3d63254ecc7d05bdec610c85c8dde7508e07f41e3d4b76cdae2d27769559b8`.
- Architecture: torchvision Faster R-CNN ResNet-50-FPN-v2; original initialization COCO_V1. Runtime loads the fine-tuned state strictly, with no pretrained download.
- Mapping: sedan/SUV/hatchback/van → car; pickup → truck. Primary ground truth: visible boxes.
- PIL EXIF transpose and RGB; float32 [0,1]; torchvision internal ImageNet normalization and aspect-ratio resize, min side 384/max side 684.
- Confidence 0.65; space coverage 0.45; OPEN disabled. FP32, no autocast, TF32 disabled. No test-driven tuning.

## Linux/CUDA runtime and launch

Prepared base: `python:3.12.13-slim-bookworm`, Linux amd64. PyTorch 2.14.1 / torchvision 0.29.1 match the accepted CPU environment. Linux PyPI dependencies use CUDA 13 (as recorded in inherited uv.lock); actual CUDA minor version is captured from `torch.version.cuda` on execution. NVIDIA Container Toolkit is required on the host. CUDA 13 requires driver branch 580 or newer per [NVIDIA compatibility documentation](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html); confirm the resolved runtime and GPU architecture are supported before running.

This image has **not been built or GPU-tested locally**. Direct dependencies are pinned; base tag and transitive packages are not content-locked. Save the built image ID/digest and `/app/resolved-requirements.txt` for replay; the report also captures pip freeze. A first successful Linux build is a remaining validation step, not an established result.

On an **already authorized GPU host**, from this repository root, with artifacts already staged under the following host paths:

```sh
docker build --platform linux/amd64 -f experiments/a2-gpu-validation/Dockerfile -t parkright-a2-gpu:validation .
mkdir -p experiments/a2-gpu-validation/output
docker image inspect parkright-a2-gpu:validation --format '{{.Id}}'
docker run --rm --gpus '"device=0"' --network none --read-only --tmpfs /tmp:rw,size=256m \
  -v "$HOME/.cache/parkright/models/a2-fasterrcnn:/model:ro" \
  -v "$HOME/.cache/parkright/datasets/a2-sim-v1-b569da957c:/dataset:ro" \
  -v "$PWD/experiments/a2-gpu-validation/output:/output:rw" \
  parkright-a2-gpu:validation --seconds 60
```

Do not run these commands on a newly paid/provisioned host without explicit approval. No cloud commands are included. No credentials enter the build context. The model directory must contain `best.pt` and original `frozen.json`; the dataset contains canonical manifest plus referenced images and labels. The image copies only research Python and frozen config. A successful prior output is not overwritten.

## Protocol and interpretation

Cold-process model load includes constructing the architecture, disk checkpoint read, strict state load, CUDA transfer and synchronization. CUDA device discovery occurs before this timer; it excludes interpreter/import and initial device-discovery overhead. It is not a flushed-filesystem-cache measurement. Ten validation images warm up the model. One hundred sequential validation inferences measure batch-one mean/median/nearest-rank p95/p99. These include host→GPU transfer, inference, GPU→CPU prediction materialization and synchronization, but exclude JPEG decoding. FPS trials include decoding and full processing.

Each 60-second 1/2/5 FPS trial uses a producer independent of inference, one waiting slot, and drop-newest when full. Reports distinguish attempted, admitted, completed, scheduler-skipped, dropped, completion within the offered-load window, queue delay, deadline misses, draining, and latency growth. Conservative `sustainable` means no dropped/skipped frames and all completed within one frame interval. This is a local offline queue, not API/network/production latency. A 60-second trial is not a long-duration soak test.

Telemetry samples process RSS plus nvidia-smi GPU UUID/name/driver, used/total MiB and utilization percent every 0.5s; raw telemetry is retained. GPU utilization/memory can include other processes; use a dedicated device and inspect interference. PyTorch peak allocation/reservation is captured separately. Missing telemetry is explicitly recorded, not interpreted as zero.

The user-authorized device sanity check uses two lexicographically first TEST sample IDs per environment/subset/family/settled-or-transition stratum, independent of predictions. CPU and GPU run the identical subset in the same Linux environment. No architecture/config/threshold selection follows this check. Label-aware IoU≥0.99 matching reports unmatched predictions, maximum score/box drift, confidence-gate crossings and parking-state changes. Any unmatched/gate/state change, score drift >0.001 or box drift >1 source pixel requires review, not tuning. These are diagnostic tolerances, not detector thresholds. CPU→GPU comparison uses recomputed Linux CPU predictions, not unavailable historical per-frame outputs.

Precision/recall uses inherited visible-box IoU0.5 matching. Parking metrics reuse the frozen offline ROI gate; they are **not** full production quality/temporal-policy validation. OPEN remains structurally disabled. TEST is not used for throughput trials. Results/predictions/telemetry stay ignored under output; commit only a small reviewed summary after an actual run.

## Current findings and next step

Local host is Apple M2, not NVIDIA. No Nebius CLI/configuration, NVIDIA utility, or configured GPU SSH target was found; Docker contexts are local Colima/default. No cloud credentials were opened. No existing authorized remote GPU endpoint was identified.

GPU hardware/provider, actual CUDA runtime, cold load, warm-up, latency, 1/2/5 FPS, VRAM, utilization and accuracy consistency are **not measured**. Accepted historical CPU TEST latency: mean 1873.02 ms, median 1877.41 ms, p95 2035.87 ms; this is a different host and timing scope, not an apples-to-apples GPU comparison. The package recomputes CPU and GPU subset timings with a common definition.

Eligibility: [UNVERIFIED](ELIGIBILITY.md). Next step: supply an existing approved NVIDIA host, or separately approve bounded paid access. Run the image, review device drift, telemetry and sustainable FPS before proposing integration. Do not integrate A2, enable OPEN, or claim demo readiness based only on this package.

## Local verification

Frozen checkpoint/manifest/config checks passed. Metadata-only subset selection yields 38 frames across 21 strata; no new TEST inference was performed locally. GPU tests, image build and live CUDA execution remain unperformed.

```sh
python -m pytest -q -ra experiments/a2-gpu-validation/test_benchmark.py experiments/a2-finetune/tests services/perception/tests
```

Result: 45 passed, 1 skipped (A0 real NVIDIA smoke test requires explicit source/weights). Python AST syntax checks and git whitespace checks passed. Tests cover hashes/config policy, deterministic subset coverage, comparison drift/gate crossing, percentiles, queue accounting and overload. The smoke test is not a GPU-validation substitute.
