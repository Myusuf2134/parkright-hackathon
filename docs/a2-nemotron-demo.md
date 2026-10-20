# A2 + Nemotron local demo runbook

Branch `integration/a2-nemotron-demo` (base `integration/a0-vertical-slice` 255026a, plus the
Nemotron commits from `feat/nemotron-recommendation`). Functional integration on CPU only.
**GPU performance has not been validated**; do not claim real-time performance until it has been
measured on NVIDIA hardware.

```text
Three.js simulator (cam-01) → JPEG → FastAPI → detector (A2 Faster R-CNN | A0 SSD300)
  → calibrated 12-space mapper (occupied ≥ 0.65 conf, ≥ 0.45 coverage, OPEN disabled)
  → occupancy state → WebSocket → driver UI
  → POST /api/v1/facilities/{id}/recommendation (facts assembled by the API from that state)
  → Nebius Token Factory → nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B → strictly validated decision
  → backend-rendered recommendation → driver UI
```

## Prerequisites (once)

```sh
uv sync --frozen --all-packages --all-extras --group dev
npm ci --ignore-scripts
npx playwright install chromium          # browser tests only
```

Artifacts, outside Git:

| Detector | Artifact | Verified |
|---|---|---|
| A2 (`a2`) | `~/.cache/parkright/models/a2-fasterrcnn/best.pt` | SHA-256 `43452092…c24985` before `torch.load(weights_only=True)` |
| A0 (`a0`) | `~/.cache/parkright/nvidia-ssd` (pinned git checkout) and `~/.cache/parkright/nvidia-ssd.pt` | source revision + SHA-256 (see `experiments/a0-baseline/README.md`) |

A missing or different A2 checkpoint is never loaded: the API starts with detector phase
`unavailable` and every space stays UNCERTAIN. No other model is substituted.

## Environment variables (no secrets in files or commands)

| Variable | Default | Meaning |
|---|---|---|
| `PARKRIGHT_PERCEPTION_PROVIDER` | `a0` in `scripts/integration/api.sh`; `none` otherwise | `a2`, `a0` or `none` |
| `PARKRIGHT_A2_CHECKPOINT` | `~/.cache/parkright/models/a2-fasterrcnn/best.pt` | A2 checkpoint path |
| `PARKRIGHT_A2_DEVICE` | `cpu` | `cpu` or `cuda` (explicit; CUDA unvalidated) |
| `PARKRIGHT_A0_SOURCE` / `_WEIGHTS` / `_DEVICE` | `~/.cache/parkright/…`, `cpu` | A0 only |
| `PARKRIGHT_INGEST_TOKEN` | unset (open, development only) | camera/evaluation bearer token; give the API and the simulator the same value |
| `NEBIUS_API_KEY` | unset | read only by the API process. Unset → labelled local fallback |

Export `NEBIUS_API_KEY` from your secrets manager in the API terminal only. Never put it in
`.env`, the repo, a browser variable or a command saved in shell history.

A2 thresholds are fixed by the factory (`parkright_perception/a2/provider.py`) and ignore
`PARKRIGHT_A0_CONFIG`: occupied confidence 0.65, coverage 0.45, `allow_open` false.

## Launch (three terminals, repository root)

```sh
# 1. API on :8400 with A2 (use `npm run dev:a0` for the A0 baseline)
npm run dev:a2
# 2. Simulator "Vision Lab" on :5181 (proxies /api to :8400)
npm run dev:sim
# 3. Driver app on :5180 (proxies /api to :8400)
npm run dev:web
```

Wait until `curl -s 127.0.0.1:8400/api/v1/health` shows `"perception":{"provider":"a2-fasterrcnn"…}`
and `"inference_ready":true` (cold start about 4 s on an M2).

## Demo flow

1. Simulator http://127.0.0.1:5181/#seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0. Wait for
   inference readiness `ready`, then **Send frame** (or set a capture rate).
2. Driver http://127.0.0.1:5180 → **ParkRight Virtual Garage**. It shows
   `detector: A2 Faster R-CNN · ready · OPEN disabled`, the
   `perception: a2-fasterrcnn@…` provenance, the recommender status, and the plan: A1, A3, B2 and
   B5 Occupied; the other eight are Uncertain (never Open).
3. **Get recommendation**. The browser sends no facts. The API builds them from its own
   occupancy state: `total_spaces` 12, `available_spaces` = confirmed fresh OPEN standard spaces,
   `occupancy_percentage` only when every space is resolved, walking/distance/traffic/status
   unknown. Expand **Recommendation provenance and facts sent** to see exactly what was used.
4. Expected result **with OPEN disabled**: `available_spaces` is 0, so Nemotron is **not**
   called and the panel shows
   `Local fallback — not a Nemotron recommendation (no space is confirmed available, so Nemotron
   was not asked)`. This is the intended safety behaviour: no availability is invented from
   missing detections or UNCERTAIN spaces.
5. When a fact source can confirm availability (an OPEN-capable detector after a false-OPEN
   evaluation, or another facility feed), the same endpoint sends Nemotron only those structured
   facts plus the allowed reason and required uncertainty codes. The backend validates the
   returned facility ID and codes and renders the wording itself. With `NEBIUS_API_KEY` unset,
   or if Nebius fails, the response is a deterministic, explicitly labelled fallback.

Endpoints: `GET /api/v1/recommendations/status` (provider, model, `configured`; never the key),
`POST /api/v1/facilities/{facility_id}/recommendation` (state-grounded; 409 `no_observation`
before the first fresh frame), and the original caller-supplied
`POST /api/v1/recommendations` (unchanged; see `docs/nemotron-recommendations.md`).

## Tests

```sh
.venv/bin/python -m pytest -q                       # all Python tests (A2 real tests run when the checkpoint/dataset exist)
npm run typecheck && npm run lint && npm run build -w @parkright/web && npm run test:sim
npm run test:integration:stub                       # transport with a stub detector
npm run test:integration:a2                         # real A2 browser suite incl. demo.spec.ts
npm run test:integration:real                       # real A0; its positive-vehicle gate is a known failure
# Optional, billed: PARKRIGHT_NEMOTRON_LIVE=1 with NEBIUS_API_KEY exported
.venv/bin/python -m pytest -q -s services/api/tests/test_recommendations.py -k live_nemotron
```

## Observed CPU performance (Apple M2, this branch)

- Detector warm-up (cold): 3.8 s.
- Real held-out frame through the mapper: 1.25 to 1.55 s total per frame.
- Browser pipeline (capture → 202): mean 1.66 to 1.73 s, p95 1.76 to 1.91 s at attempted 1, 2 and 5
  fps. Accepted throughput 0.5 to 0.6 fps, because frames that arrive while the detector is busy
  are skipped. Peak API RSS 910 MB.
- GPU (CUDA) latency: **not measured**.
