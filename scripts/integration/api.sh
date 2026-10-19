#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
export PARKRIGHT_PERCEPTION_PROVIDER=a0
export PARKRIGHT_A0_SOURCE="${PARKRIGHT_A0_SOURCE:-/tmp/parkright-nvidia-ssd}"
export PARKRIGHT_A0_WEIGHTS="${PARKRIGHT_A0_WEIGHTS:-/tmp/parkright-nvidia-ssd.pt}"
export PARKRIGHT_A0_DEVICE="${PARKRIGHT_A0_DEVICE:-cpu}"
export PARKRIGHT_CALIBRATION_FILE="$PWD/packages/shared/calibration/cam-01.json"
export PARKRIGHT_FACILITY_FIXTURES="[\"$PWD/packages/shared/calibration/facility.json\"]"
exec uv run --frozen --all-packages --all-extras python -m parkright_api
