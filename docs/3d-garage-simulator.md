# 3D garage simulator

Branch `feat/3d-garage-simulator` (base `feat/hackathon-demo-mode` 8bc94dd). This adds a
deterministic 3D covered-garage front-end with its own fixed CCTV camera. It feeds the
**unchanged** ParkRight backend: FastAPI ingest, the A2 production provider, the mapper,
live state over the WebSocket, the recommendation service and Nemotron. **OPEN remains
disabled.** The legacy simulator is still the default and is unchanged in behaviour.

```text
3D garage + scripted vehicles + fixed CAM-01 → rendered RGB → JPEG → existing POST /cameras/cam-01/frames
  → A2 Faster R-CNN → calibrated bay polygons (auto-projected from 3D) → live state → WebSocket
  → driver demo screen → grounded facts → Nemotron (or labelled fallback) → recommendation
```

## Running it

```sh
npm run demo:hackathon:garage            # API with the garage calibration + simulator + driver app
# Simulator: http://127.0.0.1:5181/?sim=garage&scenario=entering&env=night
# Demo mode:  http://127.0.0.1:5181/?demo=1&sim=garage    Driver: http://127.0.0.1:5180/?record=1
npm run demo:hackathon                   # unchanged: the legacy simulator (still the recording default)
```

Simulator URL parameters: `sim=garage`, `scenario=<id>`, `env=day|dusk|night|overcast`, `t=<ms>`,
`play=1`, `calib=1` (calibration overlay), `record=1` (hides the debug overlays and the observer view),
and `demo=1` (fixed demo scene; streams once A2 is ready; reloads on `demo:reset`).

To run beside another demo, set `PARKRIGHT_DEMO_API_PORT`, `PARKRIGHT_DEMO_SIM_PORT`,
`PARKRIGHT_DEMO_WEB_PORT` and `PARKRIGHT_DEMO_STATE_DIR`. That is how this branch was tested while
the stable demo kept running on 8400, 5180 and 5181.

## What was built

| Part | Where | Notes |
|---|---|---|
| Geometry data | `apps/simulator/src/garage/layout.ts` | 12 bays as explicit 3D corners (id, row, level), structure, CAM-01 pose; pure data |
| Garage scene | `garage/scene.ts` | concrete slab, painted bay lines with stencilled IDs, wheel stops, yellow centre line, direction arrows, crosswalk, EXIT stencil, columns with safety-yellow bases, open-deck spandrel walls, solid south wall with stair door and sign, ceiling slab, beams, sprinkler pipes, 11 LED fixtures with lights, hanging EXIT sign, entrance headroom bar ("CLEARANCE 2.1 m"), speed sign, street and buildings outside |
| Vehicles | `garage/vehicles.ts` on `scene/vehicleModel.ts` | sedan, hatchback, SUV, pickup, van; seeded colours and sizes; mirrors, plates, grille |
| Scenarios | `garage/scenarios.ts` | 10 deterministic scenarios from waypoint routes (straights and quadratic curves, eased speed, reversing legs) |
| World and ground truth | `garage/world.ts` | sim time only moves through `advance()` and `setTime()`; truth = bays ≥30% covered by vehicle footprints, plus vehicle poses, scenario and time |
| Lighting | `garage/presets.ts` | day, dusk, night, overcast; daylight through the openings, ambient, fixtures, exposure, haze |
| Engine | `garage/lab.ts` | `captureFrame()` renders CAM-01 and encodes the JPEG from exactly those pixels; reads truth for the same instant |
| UI | `garage/GarageApp.tsx`, `garage/boot.tsx` | CAM-01 view, observer view (free orbit, ceiling cut away), scenario and lighting selectors, play/pause/reset/timeline, stream controls, frame status, debug overlays |
| Calibration | `scripts/generate-garage-calibration.mjs` → `packages/shared/calibration/garage/` | 3D bay corners → CAM-01 projection → `cam-01.json` and `facility.json` in the existing format |

The garage is loaded lazily (`?sim=garage` → `import('./garage/boot.tsx')`), so the legacy lab never
loads it. Its code is a separate 47 kB chunk in the build.

### Vehicle assets and licences

There are no external assets. Every vehicle, texture and sign is generated in code in this
repository: the procedural body styles from `scene/vehicleModel.ts`, plus the detail parts. Sign
text is drawn at runtime into canvas textures with the system's Helvetica or Arial; no font files
are shipped. There are no third-party models, so there are no licence obligations. Low-poly custom
vehicles were chosen over downloaded models to avoid licence and network risk.

### Cameras

- **CAM-01** is the only camera that feeds ParkRight. It is a fixed CCTV camera under the beams at
  the south-west corner of the walkway: position (3, 3.8, 21.5) m, yaw −25°, pitch −45°, vertical
  FOV 78°, 1280×720. All 12 bays are in frame. The observer camera is a separate renderer and never
  ingested. Operator overlays live on a layer CAM-01 does not render, and calibration polygons,
  detections and truth are drawn as DOM over the image.
- **CAM-02** was not added. The API's calibration loader accepts only `cam-01`
  (`services/api/src/parkright_api/calibration.py`), so a second camera would need an API change,
  which this milestone excluded. CAM-02 is the main fix for the mapping limit described below.

### Scenarios

| ID | What happens | Bays occupied at end |
|---|---|---|
| `static` | the demo scene, parked only | A1 A3 B2 B5 |
| `entering` | a red sedan drives in from the west and parks in A5 | A1 A5 B2 |
| `exiting` | the B5 car reverses out and leaves by the east ramp | A1 A3 B2 |
| `pass-by` | an SUV drives the length of the aisle without parking | A1 A3 B2 B5 |
| `crossing` | a sedan eastbound and a van westbound pass each other | A1 A3 B2 B5 |
| `neighbor-approach` | a car stops beside occupied A3, then parks in A4 | + A4 |
| `fast-approach` | a car arrives at 7 m/s and parks in B4 | + B4 |
| `occlusion` | a car parks in A4 while a van passes between it and the camera | + A4 |
| `full-garage` | every bay occupied | all 12 |
| `sparse-garage` | two cars | A2 B5 |

Every scenario is a pure function of `(scenario, seed 4242, t)`. Tests check exact reproducibility,
starting poses, end states and route timing.

### Calibration

Polygons are not drawn by hand. `generate-garage-calibration.mjs` projects each bay's four 3D floor
corners (y = 0.025 m) through a three.js `PerspectiveCamera` with CAM-01's pose. It writes them in
the format the API already loads, plus `image`, `bays_3d` and pixel coordinates for inspection. The
API's own `Calibration` loader accepts the file, and `matches_view` agrees with the generated
facility. A test re-projects the corners and compares them to 1e-6. The overlay
(`evidence/calibration-overlay.png`) shows each polygon lying inside the painted lines of its bay.
`npm run calibration:garage:check` fails on any drift.

## A2 on the garage (no thresholds changed, no retraining)

The harness is `experiments/3d-garage-simulator/measure.mjs`. It runs every scenario × day, dusk and
night, one frame every 1.5 s of sim time (330 frames per run). Frames go through the real API with A2
and the garage calibration, and are scored against simulator ground truth. Ground truth is used only
by the harness and never sent with a frame. The mapper is unchanged: occupied at confidence ≥0.65
and coverage ≥0.45, `allow_open` false.

| Render | Preset | Occupied precision | Occupied recall | False-occupied rate | Vehicle detections ≥0.65 per frame | Mean confidence | A2 mean / p95 |
|---|---|---:|---:|---:|---:|---:|---:|
| v1 baseline | day | 0.657 | 0.974 | 0.271 | 7.29 | 0.90 | 1.61 / 2.26 s |
| v1 baseline | dusk | 0.648 | 0.956 | 0.276 | 6.27 | 0.90 | 1.89 / 2.91 s |
| v1 baseline | night | 0.607 | 0.941 | 0.325 | 8.96 | 0.90 | 1.88 / 2.53 s |
| **v2 adjusted** | day | 0.758 | 0.937 | 0.159 | 5.17 | 0.90 | 2.28 / 3.73 s |
| **v2 adjusted** | dusk | 0.759 | 0.926 | 0.157 | 5.04 | 0.90 | 2.19 / 3.94 s |
| **v2 adjusted** | night | 0.762 | 0.922 | 0.153 | 5.96 | 0.90 | 2.36 / 4.44 s |

Across all 330 frames of each run: OPEN was reported **0** times and no frame failed. Per-frame
results are in `evidence/metrics/*-frames.csv`, and per-scenario numbers in `*-metrics.json`.
Latencies were measured on a shared, loaded laptop (load average 6–11) with another A2 demo running.

### The domain gap, documented first

1. **Detection is not the weak part.** Vehicles are found with high confidence in all three
   lighting presets (mean 0.90). Lighting barely changes the result: v2 precision is 0.758, 0.759
   and 0.762.
2. **v1: hazard-striped columns read as vehicles.** A2 returned "car" for the black-and-yellow
   column bases, at up to 1.00. That is a real domain gap: A2 never saw such columns.
3. **Neighbour-bay spill from a low camera (the dominant error).** The mapper marks a bay occupied
   when a vehicle's 2D box covers ≥45% of its polygon. From a camera under a 4.2 m ceiling, a parked
   car's box spills over the next bay. This is viewing geometry, not detection.
   `camera-geometry.mjs` projects a reference SUV in every bay and finds:
   - v1 pose: **11 of 132** bay pairs where even a perfect detector creates a neighbour false
     positive;
   - best pose under the ceiling: **7**;
   - best pose by mount height: 3.8 m → 7, 4.8 m → 2, 5.8 m → 2, 8 m → **0** (the legacy lot's pole
     camera is at 10.5 m).

   The measured false positives match the prediction: v1 B3 = 294 and B6 = 240 (from B2 and B5); v2
   B6 = 240.
4. **Far-corner misses.** A4, A5 and A6 are small and partly hidden by the B row and the columns
   (recall 0.92–0.94).

### Render adjustment v2 (camera and materials only)

- **Camera:** CAM-01 moved to the best pose under the ceiling (above). Calibration was regenerated
  automatically as version `garage-cam-01-v2`.
- **Materials:** the striped column bases became a solid safety-yellow band.

Result: precision went from 0.64 to 0.76, the false-occupied rate from 0.29 to 0.16, and vehicle
detections per frame from 7.5 to 5.4 (the column hits are gone). Recall went from 0.96 to 0.93 (far
row is smaller from the new pose). The B5 → B6 spill remains. No camera position under a 4.2 m
ceiling removes it.

### Classification: **B. USABLE WITH RENDER ADJUSTMENTS** (with one documented limit)

- A2 itself is usable on the rendered garage without retraining. It detects vehicles reliably in
  day, dusk and night, and the one detector-level gap (striped columns) was removed by a materials
  change.
- Model adaptation is **not** what is needed: the remaining error is geometric. Box-in-polygon
  mapping from a single camera mounted at about 3.8 m cannot separate side-by-side bays. Retraining
  A2 would not change that.
- Fixing it needs one of the following, none of which was done here:
  - a second camera per row (CAM-02; needs the API to accept more than `cam-01`);
  - a taller mount (a deck of about 6–8 m);
  - a mapping change, for example using the box's ground-contact edge instead of the whole box. That
    is a production-perception change and is out of scope.

## Driver demo integration

`npm run demo:hackathon:garage` runs the existing demo flow on the garage. Status:

- **Works end to end:** the live CAM-01 frame with A2 boxes on the driver screen, bay states over
  the WebSocket, and the recommendation "Tuttle Garage · Level 2 · Space B12 · 4-minute walk"
  (`evidence/driver-demo-on-garage.png`).
- **Not recording-ready:** the demo scene (A1, A3, B2, B5 parked) also reads **B6 Occupied**, the
  geometric spill above. `demo:check` reports `[FAIL] camera stream — occupied A1,A3,B2,B5,B6`
  (`evidence/demo-check-garage.txt`), and the demo reliability test fails on the same assertion.
  Nothing was changed to hide this; the demo fixture and thresholds are untouched.
- **Recommendation:** keep recording with the legacy simulator (`npm run demo:hackathon`). Use the
  garage as a visual showcase, or once CAM-02 or ground-contact mapping exists.

## Performance (`evidence/performance.json`, CAM-01 streaming at 1 fps for 40 s)

| Measure | Value |
|---|---|
| Simulator preview | 13 fps (p95 14), headless Chromium with Metal |
| Frames attempted / accepted | 40 / 17 (23 ticks skipped while A2 was busy; skipped, not queued) |
| Accepted capture rate | 0.42 fps |
| JPEG encode | 27 ms mean, 37 ms p95 |
| Ingest, capture → 202 | 1.92 s mean, 2.89 s p95 |
| A2 inference | 1.90 s mean, 2.80 s p95 |
| Camera → state on the WebSocket | 1.96 s mean, 2.93 s p95 |

A2 on the CPU is the bottleneck; GPU latency is not measured.

## Ground truth

Truth is produced in `GarageWorld.truth()`: per-bay occupancy, scenario, vehicle poses and sim time.
It leaves only through the existing evaluation module (a separate request to the evaluation route)
and the local harness. A frame upload is exactly `metadata` + `image`. Tests check, for the garage:
- the browser upload's parts, metadata keys, JPEG validity and size;
- that posting garage ground truth leaves facility state untouched;
- that a frame with an extra `truth` part is rejected;
- that perception only ever receives pixels and frame metadata.

## Tests

- `apps/simulator/test/garage.test.ts` (16): bays equal the facility fixture, scenarios, exact
  starting poses, route reproducibility, end states, crossing, reset, scenario switching, truth,
  camera ID, presets, projection, polygon validity, calibration drift, no OPEN.
- `services/api/tests/test_garage_simulator.py` (7): calibration accepted by the unchanged API, a
  real rendered JPEG through ingest, pose and size refusal, ground-truth isolation, OPEN disabled,
  the demo on garage frames, and real A2 on a rendered garage frame.
- `scripts/garage/garage.spec.ts` (3, browser): JPEG and camera ID and no truth in the upload,
  scenario and lighting switching with reset, and the calibration view with no OPEN.
- The demo reliability and reset tests take `PARKRIGHT_DEMO_SIM=garage` and alternative ports.

## Known limitations

- Neighbour-bay spill (above): one false-occupied bay in the demo scene; not recording-ready on the
  garage.
- A single camera; CAM-02 needs API support for more cameras.
- The vehicles are clean low-poly, not photoreal; A2 was fine-tuned on similar procedural vehicles,
  so the results do not transfer to real cameras.
- Lighting is forward-rendered with simple shadows (one shadow-casting light); there is no global
  illumination.
- Performance is CPU A2 on a shared laptop; latencies rise sharply under background load.
