# evaluation — `parkright_evaluation`

The only home of simulator ground truth (`GroundTruthRecord`, packages/contracts). Used to score the
detector arms (experiments/a0…a3), in tests and for debugging.

Dependency direction is one-way: evaluation may read what perception produced; nothing in the
perception path (`services/perception`, the API's frame route, the state store) may import this package.
`services/api/tests/test_ground_truth_isolation.py` enforces that.

Today: an in-memory `GroundTruthStore`, filled by `POST /api/v1/evaluation/ground-truth`.
Next: per-session scoring (accuracy, false-OPEN rate, UNCERTAIN coverage) per arm and per environment preset.
