# services/api — `parkright_api`

FastAPI app. `create_app(settings, perception=None)` in `main.py`; run with `uv run python -m parkright_api`.

- `routes/frames.py` — `POST /api/v1/cameras/{camera_id}/frames` (the production perception path)
- `stream_tracker.py` — frame ordering per (camera, session)
- `state.py` — `FacilityState` / `FacilityRegistry`, loaded from `packages/shared/fixtures/*.json`
- `realtime.py`, `routes/realtime.py` — `WS /api/v1/realtime`
- `routes/facilities.py`, `routes/health.py` — read API
- `routes/evaluation.py` — ground truth; imported only when evaluation is enabled
- `upload_limit.py` — caps frame request size before multipart parsing
- `config.py` — `PARKRIGHT_*` settings (see `.env.example`)

Contract and behaviour: [docs/frame-contract.md](../../docs/frame-contract.md).
