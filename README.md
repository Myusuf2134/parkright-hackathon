# ParkRight — NVIDIA × Nebius Global AI Hackathon

Camera-based parking intelligence. Infrastructure cameras watch parking spaces; perception decides
which are **OPEN**, **OCCUPIED** or **UNCERTAIN**; drivers see live availability and pick a legal open
space. Nothing is installed in the driver's vehicle.

For the hackathon the car park is virtual, but the pipeline is the one a real deployment would run:

```
virtual parking environment ─▶ virtual camera ─▶ JPEG frame
   ─▶ POST /api/v1/cameras/{camera_id}/frames ─▶ PerceptionProvider (NVIDIA model)
   ─▶ occupancy state ─▶ realtime (WebSocket) ─▶ driver UI
```

**Simulator ground truth never enters that path.** It goes to `/api/v1/evaluation/ground-truth` and
is used only to score perception.

## Run it locally

Needs [uv](https://docs.astral.sh/uv/) (Python 3.12 is fetched automatically) and Node ≥ 22.

```bash
uv sync && npm install
cp .env.example .env                 # set PARKRIGHT_INGEST_TOKEN
npm run dev:api                      # API  http://127.0.0.1:8400  (OpenAPI: /api/v1/docs)
npm run dev:web                      # driver web app  http://localhost:5180
npm run dev:sim                      # PARKRIGHT VISION LAB (simulator + cam-01)  http://127.0.0.1:5181
npm run test:camera                  # optional: test-pattern frames without the simulator
npm test                             # Python tests + generated-contract drift check
npm run test:sim                     # simulator unit tests (determinism, isolation)
npm run test:sim:e2e                 # simulator + real API in Chromium (starts both itself)
npm run typecheck
```

With no detector connected every space is **UNCERTAIN**. That is the expected first milestone: frames
flow end to end, and nothing is claimed that no model produced.

## Docs

- [docs/frame-contract.md](docs/frame-contract.md) — the camera contract, ordering, occupancy semantics, ground truth
- [docs/architecture.md](docs/architecture.md) — layout and decisions
- [docs/simulator.md](docs/simulator.md) — Vision Lab: scene, cam-01, determinism, streaming, ground-truth isolation
- [experiments/](experiments/README.md) — detector arms A0–A3
