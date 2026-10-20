#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
# Detector selection: a0 (NVIDIA SSD300, default) or a2 (fine-tuned Faster R-CNN).
export PARKRIGHT_PERCEPTION_PROVIDER="${PARKRIGHT_PERCEPTION_PROVIDER:-a0}"
export PARKRIGHT_A0_SOURCE="${PARKRIGHT_A0_SOURCE:-$HOME/.cache/parkright/nvidia-ssd}"
export PARKRIGHT_A0_WEIGHTS="${PARKRIGHT_A0_WEIGHTS:-$HOME/.cache/parkright/nvidia-ssd.pt}"
export PARKRIGHT_A0_DEVICE="${PARKRIGHT_A0_DEVICE:-cpu}"
export PARKRIGHT_A2_CHECKPOINT="${PARKRIGHT_A2_CHECKPOINT:-$HOME/.cache/parkright/models/a2-fasterrcnn/best.pt}"
export PARKRIGHT_A2_DEVICE="${PARKRIGHT_A2_DEVICE:-cpu}"
export PARKRIGHT_CALIBRATION_FILE="$PWD/packages/shared/calibration/cam-01.json"
export PARKRIGHT_FACILITY_FIXTURES="[\"$PWD/packages/shared/calibration/facility.json\"]"
exec uv run --frozen --all-packages --all-extras python -m parkright_api
