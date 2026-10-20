#!/bin/sh
# OFFLINE temporal OPEN-evidence dataset: generate → render-free re-plan (must be byte-identical) → validate.
#   scripts/dataset/build-temporal.sh [config.json] [output-dir]
set -eu
cd "$(dirname "$0")/../.."
CONFIG="${1:-experiments/a2-open-evidence/configs/a2-temporal-v1.json}"
if [ $# -ge 2 ]; then OUT="$2"; else OUT="$(node scripts/dataset/generate.mjs --config "$CONFIG" --print-out)"; fi
PY="uv run --frozen --all-packages --all-extras python"
node scripts/dataset/generate.mjs --config "$CONFIG" --out "$OUT" --force
node scripts/dataset/generate.mjs --config "$CONFIG" --out "$OUT.plancheck" --force --plan-only
$PY experiments/a2-open-evidence/validate_temporal.py "$OUT" --compare-manifest "$OUT.plancheck/manifest.jsonl"
rm -rf "$OUT.plancheck"
