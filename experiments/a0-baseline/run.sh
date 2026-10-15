#!/bin/sh
# Isolated execution without changing the workspace lock or simulator dependencies.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export PYTHONPATH="$ROOT/services/perception/src:$ROOT/packages/contracts/src:$ROOT/services/api/src:$ROOT/evaluation/src${PYTHONPATH:+:$PYTHONPATH}"
exec "${A0_PYTHON:-python}" "$@"
