# @parkright/site — public website

A static, single-page site (React 19 + Vite + TypeScript). It needs no API: every image is a real
capture from the student app or the simulator's evidence, and the Arrival Intelligence card runs the
app's own engine (`apps/web/src/driver/arrival`) on its built-in demo scenarios, in the browser.

```bash
npm install                      # from the repo root, once
npm run dev:site                 # http://localhost:5190/  (buttons point at the local demo on :5180)
npm run build:site               # → apps/site/dist (static files)
npm run preview -w @parkright/site
npm run test:e2e -w @parkright/site   # builds, serves, tests at 1440 px and iPhone 15
```

## Where the buttons go

| Env var (build time) | Used by | When unset |
| --- | --- | --- |
| `VITE_PARKRIGHT_APP_URL` | Try ParkRight / Try Student App | `#run` (how to run it locally); `vite dev` uses `http://localhost:5180/app/` |
| `VITE_PARKRIGHT_DEMO_URL` | See the AI Demo / Open Live Demo | `#run`; `vite dev` uses `http://localhost:5180/present/` |
| `VITE_PARKRIGHT_WALKTHROUGH_URL` | "Watch recorded walkthrough" (only shown when set) | hidden |
| `VITE_PARKRIGHT_REPO_URL` | GitHub links | the hackathon repository |

A production build never links to localhost (a browser test checks this).

## Deploying

Any static host. Build command `npm ci && npm run build:site`, output directory `apps/site/dist`,
Node 22. The live student app and `/present/` need the API, simulator and A2 running, so they are
not part of this static deploy; point the env vars above at wherever they are hosted, or at a
recorded walkthrough.

## Content rules

- App screens: captured from `/app/` (scripted demo data on the simulated garage), labelled as such.
- Camera imagery: rendered by the Three.js simulator, labelled "not real-world CCTV".
- The Ohio-inspired garage is not an official or exact digital twin; A2 reports occupied and
  can't-confirm only (OPEN disabled). Schedules, traffic, weather and departure times are demo.
- No invented statistics, accuracy or performance numbers.
