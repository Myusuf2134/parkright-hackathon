# Architecture

```
apps/simulator ──JPEG frames──▶ services/api ──▶ services/perception (PerceptionProvider)
      │                              │
      └──ground truth──▶ /evaluation │ FacilityState (memory) ──WS──▶ apps/web
                         evaluation/ ◀┘ (may read production output; never the reverse)
```

| Path | What | Language |
| --- | --- | --- |
| `packages/contracts` | Wire contracts. Pydantic = source of truth → JSON Schema → TypeScript | Python + generated TS |
| `packages/shared` | Facility fixture (`garage-01`, `L1`, A1–A6, B1–B6, `cam-01`) | JSON |
| `services/api` | FastAPI: frame ingestion, ordering, state, realtime, read API, evaluation route | Python |
| `services/perception` | `PerceptionProvider` protocol, safety normalisation, provider registry | Python |
| `evaluation` | Ground-truth store; later, per-arm scoring | Python |
| `apps/web` | Driver view: facilities, live level plan, choose an open space | React + TS |
| `apps/simulator` | Virtual environment + virtual camera (separate workstream) | — |
| `experiments/a0…a3` | Detector arms, each delivered as a `PerceptionProvider` | — |
| `infrastructure/` | Nebius + Docker (not started) | — |

## Decisions

- **Python backend.** Inference, image processing, evaluation and Nebius deployment are Python-first.
  Perception runs in-process with the API today. Moving it to a GPU host is a provider that forwards
  the frame to an inference endpoint. The camera contract and API do not change.
- **One contract source.** Pydantic models generate the JSON Schema and TypeScript types. Constants
  (`MIN_OPEN_CONFIDENCE`, part names, size limits, identifier pattern) are exported too.
- **Smallest state layer.** `FacilityState` is in memory and derives driver-visible state at read
  time. Persistence (SQLite/Postgres) can replace it behind the same methods when it is needed, e.g.
  for keeping observation history for evaluation.
- **One shared ingest token** for cameras and the evaluation feed, required in production. There are
  no user accounts: availability is public and read-only.
- **Realtime = one WebSocket per facility.** Messages carry the whole facility, so clients replace
  rather than merge, and a dropped message costs nothing.

## Not built yet

Real detector arms, Cosmos generation, Nemotron orchestration, scoring, persistence, Nebius deployment,
navigation, permits beyond `designation`, more spaces and cameras.
