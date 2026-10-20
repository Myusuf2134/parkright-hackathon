# A2 OPEN safety evaluation

This experiment evaluates hypothetical OPEN policies without importing, changing, or enabling the API occupancy state machine. The policy thresholds are fixed from the existing A2 production mapper before inspecting the new per-space results.

Run from the repository root with the environment previously used for A2 training:

```bash
/Users/moody/Desktop/parkright-worktrees/perception-a2-finetune/.venv/bin/python \
  experiments/a2-open-evaluation/evaluate.py

/Users/moody/Desktop/parkright-worktrees/perception-a2-finetune/.venv/bin/python \
  -m pytest -q experiments/a2-open-evaluation/tests
```

The default prediction cache is `/private/tmp/parkright-a2-open-evaluation-predictions.json`. It is outside the repository, contains detections only, and may be deleted to force fresh inference.

`oracle_context_gate` is not a deployable proposal. It deliberately uses TEST-only scenario labels to measure an upper bound for visibility/transition gating that A2 does not currently produce.
