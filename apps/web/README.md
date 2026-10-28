# @parkright/web

Two entries:

| URL | What |
| --- | --- |
| `/app/` | **ParkRight driver app (V5)**: mobile-first PWA — splash, Explore (where to park), garage details, choose a space, trip, Plan with Arrival Intelligence (when to leave), You |
| `/` | Legacy screens, unchanged (`?classic=1`, `?record=1` demo screen) — the existing integration tests use these |

## Run it

```bash
# from the repo root, once
uv sync && npm install

# A. against the real API with no detector (every space UNCERTAIN — honest, but nothing to pick)
npm run dev:api
npm run dev:web                          # http://localhost:5180/app/

# B. against the real API with scripted camera states (no A2, PyTorch or GPU needed)
npm run dev:live-api -w @parkright/web   # API on :8431, demo mode, v4 states, posts its own frames
PARKRIGHT_API_URL=http://127.0.0.1:8431 npm run dev:web
#   curl -X POST localhost:8431/__test/states -H 'content-type: application/json' -d '{"A2":"OCCUPIED"}'
#   curl -X POST localhost:8431/__test/camera -H 'content-type: application/json' -d '{"paused":true}'
```

`e2e/live_api.py --site mvp|showcase|ohio` picks the 12-, 34- or 72-space garage. Add
`--detector-like --stale-ms 30000` (with `--site ohio`) to stand in for the real Ohio run without A2:
`allow_open` false, OCCUPIED/UNCERTAIN only, eight cameras reporting one at a time (~18 s cycle).

Useful query flags on `/app/`: `splash=off|full|short|reduced`, `device=iphone15` (simulates the
standalone-PWA safe areas for screenshots), `arrival=normal|quiet|traffic|weather|construction|canceled|moved|missing`
(Plan's demo scenario; also switchable from the Demo pill on Plan). On a desktop browser the app is
shown in a centred device frame. On a phone, open `/app/` and Add to Home Screen.

## Test

```bash
npm run typecheck -w @parkright/web
npm test -w @parkright/web               # unit: availability, eligibility, plan layout, Arrival Intelligence engine
npm run test:e2e -w @parkright/web       # browser: scripted backend (driver + arrival specs) and the real API via e2e/live_api.py
# In a sandbox with a preinstalled Chromium: PARKRIGHT_CHROMIUM=/path/to/chrome npm run test:e2e -w @parkright/web
```

## Rules the driver app keeps

- Only `isConfirmedAvailable` (fresh `OPEN`) spaces are offered; eligibility (accessible placard, EV) can
  only narrow that. Reserved spaces are never offered. A self-reported permit unlocks nothing.
- While the socket is down, or silent for longer than any stale window, every space is shown as can't-confirm.
- A space is re-read from the API before a trip starts and watched during it; if it is lost the trip says so
  and offers the next one. Nothing is a reservation.
- Simulated garages, demo schedules, demo garages and the demo route are labelled where they appear.
  The map is an illustration: no facility has real coordinates. A site's own disclaimer
  (`/api/v1/demo/status` → `site`) is shown verbatim in garage details and About; none is invented.
- Freshness is per space: a garage reads "Live" only while its *oldest* current view is under 12 s,
  otherwise "Camera views 1–18 s old"; a chosen space shows its own age ("Open · seen 17 s ago").
- When the detector reports `allow_open: false`, zero open means "can't confirm empty spaces", not
  "full": the app says open-space confirmation isn't enabled, offers no space, watch or advice.

## Arrival Intelligence

See [docs/arrival-intelligence.md](docs/arrival-intelligence.md): what is live (parking), what is demo
(schedule, travel times, disruptions), how relevance and departure are computed, and what each real
integration would require.
