# Hackathon demo runbook

One fixed, repeatable ParkRight demo for recording. Branch `feat/hackathon-demo-mode`
(base `feat/a2-bay-tracking` 53e2706). **OPEN remains disabled.** `allow_open` is false in the
running detector, and nothing in demo mode changes that.

## What the demo shows

```text
Simulator (fixed scene) → camera frame (JPEG) → A2 Faster R-CNN → calibrated bay states
  → live API + WebSocket → driver demo screen
  → grounded facts (demo fixture + live camera freshness) → Nebius Token Factory → NVIDIA Nemotron
  → backend validation → driver-facing result
```

The driver screen walks through seven states, shown as a progress bar along the top:

| # | State | What you see |
|---|---|---|
| 1 | Class | "Next class 10:20 AM · Dreese Laboratories", Good morning, Mahdi |
| 2 | Camera | The latest frame from the simulated garage camera |
| 3 | Detection | A2's vehicle boxes (yellow) on the frame, "A2 detector ready · 4 vehicles detected" |
| 4 | Bays | A1, A3, B2, B5 Occupied; the other eight Uncertain (never Open) |
| 5 | Compare | Tuttle 4 min / 46 spaces · Lane Avenue 7 min / 23 · Ohio Union 11 min / 31 |
| 6 | Nemotron | "Asking NVIDIA Nemotron…" (live) or "Applying local fallback…" |
| 7 | Result | **Tuttle Garage · Level 2 · Space B12 · 4-minute walk to Dreese Laboratories** |

What is live and what is a fixture:

| Live (computed every frame) | Demo fixture (`packages/shared/fixtures/hackathon-demo.json`) |
|---|---|
| Camera frame, A2 detections, bay states, WebSocket updates, detector status, `allow_open` | Student, class, destination, the three garages, walking times, traffic, **availability** (the demo availability feed) and the space shown for each garage |

The availability that makes a garage recommendable comes from the **demo availability feed**
(`services/api/src/parkright_api/demo/availability.py`). It is simulated. It never reads
or writes perception state, so it cannot turn an Uncertain bay into Open. Every value it
produces is tagged `demo-fixture` / simulated, and the screen labels it "Demo feed · simulated".
The camera's own empty-looking bays stay Uncertain. Nothing on the screen claims to be live
Ohio State or garage data.

## Start (one command)

Prerequisites (once): `uv sync --frozen --all-packages --all-extras --group dev`, `npm ci --ignore-scripts`,
`npx playwright install chromium`, and the A2 checkpoint at `~/.cache/parkright/models/a2-fasterrcnn/best.pt`
(SHA-256 `43452092…c24985`; verified before loading).

```sh
npm run demo:hackathon              # local fallback (deterministic; Nemotron never called)
npm run demo:hackathon:live         # live NVIDIA Nemotron via Nebius Token Factory (needs NEBIUS_API_KEY)
npm run demo:hackathon -- --open    # also opens the two windows
```

The command starts three services in order and waits for each:

| Order | Service | Port | Ready when |
|---|---|---|---|
| 1 | API in demo mode, A2 on CPU, evaluation off | 8400 | `/api/v1/health` answers and A2 is loaded and warmed up (about 5–10 s) |
| 2 | Simulator (Vision Lab) | 5181 | page answers |
| 3 | Driver app | 5180 | page answers |

In demo mode the API's perception timeout is 20 s instead of 10 s. Under heavy CPU load a single
A2 frame can take longer than 10 s and would be dropped with a 503. A late frame is already stale,
so its bays read Uncertain, and the longer limit only avoids dropped frames.

It refuses to start if a port is busy, the checkpoint is missing, or `--live` is used without
`NEBIUS_API_KEY`. A fresh random ingest token is shared by the API and the simulator's dev proxy
for each run; it is never printed or saved. Logs: `~/.cache/parkright/demo/logs/{api,sim,web}.log`.

**Stop:** Ctrl-C in that terminal, or `npm run demo:stop` from any terminal.

## URLs

| Window | URL |
|---|---|
| Simulator (camera) | http://127.0.0.1:5181/?demo=1#seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0 |
| Driver demo screen | http://127.0.0.1:5180/?record=1 |

Driver flags: `record=1` hides the debug detail (the facts JSON), `tech=1` opens **How it works**
(the pipeline strip for judges), `autoplay=1` asks for the recommendation by itself once the camera
has fresh evidence, and `classic=1` shows the original driver app.

In demo mode (`?demo=1`) the simulator loads the fixture's scene, starts streaming at 1 fps once A2
is ready, and reloads itself whenever the demo is reset.

## Reset (before every take)

```sh
npm run demo:reset
```

This clears the API's occupancy evidence, stream history, cached frame and result. The simulator
window then reloads into the same scene with a new session, and the driver screen clears its
result. The command waits until fresh frames are flowing again (about 5 s).

## Preflight check

```sh
npm run demo:check
```

Expected output with both windows open:

```text
ParkRight Demo Check

[PASS] API  — http://127.0.0.1:8400 healthy
[PASS] demo mode  — hackathon-tuttle-dreese-v1 · fixture ddc4df045828…
[PASS] A2 detector  — a2-fasterrcnn@1-5f91c1eb70450307c6eed130ce113dd8 ready
[PASS] OPEN disabled  — allow_open=false · no bay reported OPEN
[PASS] checkpoint hash  — 43452092…c24985
[PASS] simulator  — http://127.0.0.1:5181
[PASS] web  — http://127.0.0.1:5180
[PASS] websocket  — snapshot for garage-01 (12 bays)
[PASS] camera stream  — frame 3 · 4 vehicles · occupied A1,A3,B2,B5
[PASS] recommendation  — Tuttle Garage · Level 2 · B12 · 4-min walk · fallback
[PASS] fallback mode  — deterministic local logic; Nemotron is not called
[PASS] CPU load  — load 6.8 on 8 cores · A2 1.9 s/frame
[PASS] state  — epoch 7 · 7 frames since reset

DEMO READY
```

In live mode, the `fallback mode` line becomes `[PASS] live Nemotron`. That needs the key and a
successful, validated Nemotron answer, so the check makes one billed call. Any FAIL or WARN prints
`NOT READY` and exits 1. With no simulator window open you get WARN `camera stream`.

## Live Nemotron vs fallback

| | `npm run demo:hackathon` (fallback) | `npm run demo:hackathon:live` |
|---|---|---|
| Calls Nebius | never, even if a key is present | yes, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, temperature 0, schema-constrained |
| Result | Tuttle Garage · Level 2 · B12 (deterministic) | Nemotron's choice, validated against the facts; Tuttle is best on every supplied fact |
| Source line on screen | "Local fallback: the demo is in fallback mode, so NVIDIA Nemotron was not called." | "Chosen by NVIDIA Nemotron via Nebius Token Factory, checked by ParkRight against the demo facts." |
| If Nebius fails | — | labelled local fallback with the reason (for example `timeout`), same Tuttle result |

Live setup: in the terminal you start the demo from, `export NEBIUS_API_KEY=…` from your secrets
manager. Only the API process receives it; the simulator and web servers never do. It is never
logged, returned by any endpoint, or written to disk. Do not paste it into a command that ends up
in shell history on screen.

Nemotron sees only the structured facts for the three garages: walk, distance, traffic, status,
the demo availability counts and the destination. It may return only a facility ID and allowed
codes. The backend rejects anything else and writes the driver-facing sentence itself, so no model
text or reasoning reaches the screen.

## Expected first screen and result

- First screen (before frames): class card, garage comparison, "Waiting for the live camera…",
  camera panel "Waiting for the first camera frame…".
- After about 2 s: the frame with four yellow boxes; A1, A3, B2 and B5 Occupied; the rest Uncertain;
  the button reads **Find my parking**.
- Result: **Tuttle Garage**, **Level 2 · Space B12**, "4-minute walk to Dreese Laboratories",
  "Tuttle Garage is your best option for Dreese Labs because it gives you the shortest walk while
  meeting the demo's confirmed parking-availability criteria."

## Recording checklist

Before recording:

- [ ] Close unnecessary apps; check CPU load is low (`uptime`; A2 slows sharply when Spotlight
      or other indexing is busy).
- [ ] `npm run demo:check` prints DEMO READY.
- [ ] Live mode only: `NEBIUS_API_KEY` exported, and the check shows `[PASS] live Nemotron`.
- [ ] `npm run demo:reset`.
- [ ] Browser zoom 100%, a clean window (no bookmarks bar, no extensions popping up), size about
      1600×1000.
- [ ] Do Not Disturb on: no notifications or popups.
- [ ] No terminal with secrets on screen.
- [ ] Test the microphone separately if narrating.

Suggested take: reset → show the simulator window for a moment (camera) → switch to the driver
screen → let the frame, boxes and bay states appear → open **How it works** → **Find my parking**
→ hold on the result.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port … is already in use` | `npm run demo:stop`; if it persists, stop whatever owns the port (`lsof -nP -iTCP:8400`). |
| Start stops at "A2 detector loaded" | Checkpoint missing or hash differs (see `logs/api.log`); the demo never substitutes another model. |
| "Waiting for the live camera…" forever | The simulator window is not open, or not at the `?demo=1` URL. `demo:check` shows WARN camera stream. |
| Occupied bays differ from A1, A3, B2, B5 | The simulator is not on the demo scene; open the URL above, then `npm run demo:reset`. |
| Result says local fallback in live mode | Look at the reason in the source line (`missing NEBIUS_API_KEY`, `timeout`, `provider_http_error`); the result is still grounded. |
| `409 no_observation` | No fresh camera evidence (more than 12 s old). Keep the simulator window open. |
| Slow frames (more than 3 s) | High CPU load; close apps, wait for indexing to finish. |

## Reliability

`npm run test:demo:reliability` (with the demo running) runs the full flow five times in a row in a
real browser and then checks `demo:reset` with both windows open. Results are written to
`experiments/hackathon-demo/runs/reliability.json` (gitignored), with screenshots alongside. The
committed evidence is in `experiments/hackathon-demo/evidence/`: the final five-run result, the
check output, screenshots, and a failed attempt under heavy load (load average 11–13 from macOS
background daemons). Its result was still correct, but
dropped frames (503 perception timeouts) showed as console errors. This is why `demo:check` now
warns about CPU load and the demo uses the 20 s perception timeout.

## Known limitations

- Availability is a demo fixture, not perception. With OPEN disabled, the A2 pipeline can only say
  OCCUPIED or UNCERTAIN; the demo's confirmed spaces (including B12) come from the labelled demo feed.
- The camera bays (A1–B6, "ParkRight Virtual Garage") stand in for one camera at Tuttle Garage. B12
  itself is not one of the camera's bays.
- Walking times, traffic and capacities are fixture values, not live data.
- CPU only: about 1.5–2 s per frame on an M2; GPU latency has not been measured.
- Live Nemotron depends on the network and Nebius. In live mode, the answer can in principle differ
  from Tuttle if the model picks another valid garage; the screen would then show that garage's
  fixture space, still validated. Record in fallback mode if you need byte-identical takes.
- The simulator needs WebGL; record in a GPU-enabled browser (Chrome or Safari on macOS).
