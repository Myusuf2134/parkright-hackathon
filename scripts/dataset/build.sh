#!/bin/sh
# OFFLINE DATASET: generate, verify determinism, report, QA, COCO export, validate.
#   scripts/dataset/build.sh [config.json] [output-dir]
# Default config: experiments/a2-dataset/configs/a2-sim-v1.json
# Default output: $HOME/.cache/parkright/datasets/<dataset_version>/
set -eu
cd "$(dirname "$0")/../.."
CONFIG="${1:-experiments/a2-dataset/configs/a2-sim-v1.json}"
OUT="${2:-$(node scripts/dataset/generate.mjs --config "$CONFIG" --print-out)}"
PY="uv run --frozen --all-packages --all-extras python"

node scripts/dataset/generate.mjs --config "$CONFIG" --out "$OUT" --force
# A second, render-free planning pass must reproduce manifest.jsonl byte for byte.
node scripts/dataset/generate.mjs --config "$CONFIG" --out "$OUT.plancheck" --force --plan-only
$PY experiments/a2-dataset/report.py "$OUT" > /dev/null
$PY experiments/a2-dataset/qa.py "$OUT"
$PY experiments/a2-dataset/export_coco.py "$OUT"
status=0
$PY experiments/a2-dataset/validate.py "$OUT" --compare-manifest "$OUT.plancheck/manifest.jsonl" || status=$?
rm -rf "$OUT.plancheck"
[ "$status" -eq 0 ] && echo "dataset ready: $OUT"
exit "$status"
