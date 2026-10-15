# apps/simulator — PARKRIGHT VISION LAB

The virtual parking environment and its fixed infrastructure camera, **cam-01**. It renders a
12-bay rooftop deck (`garage-01`, level `L1`, A1–A6 / B1–B6) in three.js, captures cam-01's pixels as
JPEG and streams them to the API through the canonical frame contract.

```bash
npm run dev:sim            # http://127.0.0.1:5181 — needs the API on :8400 (npm run dev:api)
npm run test:sim           # unit tests
npm run test:sim:e2e       # Chromium + real API + real simulator (starts both on spare ports)
```

The dev server proxies `/api` to `PARKRIGHT_API_URL` (default `http://127.0.0.1:8400`) and adds
`Authorization: Bearer $PARKRIGHT_INGEST_TOKEN` on the server side (from the environment or the repo
`.env`). The token never reaches the browser.

Full description: [docs/simulator.md](../../docs/simulator.md).

| Path | |
| --- | --- |
| `src/sim/` | Pure TS world: seeded PRNG, facility geometry from the fixture, vehicles, presets, scene spec, time, ground truth |
| `src/scene/` | three.js builders: deck, lighting, vehicles, operator-only overlays, effect hook |
| `src/camera/` | cam-01 pose and `VirtualCamera` (own renderer + canvas → JPEG) |
| `src/lab.ts` | Engine: world + scene + cam-01; `captureFrame()` |
| `src/stream/` | Frame upload (contracts only), streamer, session ids, backend view |
| `src/evaluation/` | Ground truth → `POST /api/v1/evaluation/ground-truth` |
| `src/ui/` | Operator UI (React + React Three Fiber) |
