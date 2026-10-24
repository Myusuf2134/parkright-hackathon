# 34-space interactive multi-camera garage showcase

Branch `feat/garage-showcase` (base `feat/3d-garage-simulator` a52ded9). It adds a 34-space,
four-camera, continuously active virtual garage. Its rendered CCTV frames go through the
**existing** ingest → A2 → calibrated mapping → live state → WebSocket path, and the driver page
updates live. A2 was not retrained and no threshold was changed. **OPEN remains disabled.** The
deterministic demo (`?demo=1`, legacy or `&sim=garage`) is unchanged and still the stable
fallback.

## Recording startup

```sh
npm run demo:showcase -- --open          # API (A2, four calibrations) + simulator + driver; opens the presentation view
# Simulator:  http://127.0.0.1:5181/?showcase=1&sim=garage&present=1
# Driver:     http://127.0.0.1:5180/?record=1
npm run demo:check                       # DEMO READY: 4/4 cameras reporting, OPEN disabled, recommendation
npm run demo:showcase:live -- --open     # the same with live NVIDIA Nemotron (needs NEBIUS_API_KEY)
```

Simulator URL parameters:

| Parameter | Meaning |
|---|---|
| `scenario=` | `live`, `morning-rush`, `class-transition`, `nearly-full`, `sparse`, `entering`, `exiting`, `occlusion-stress`, `pass-through`, `validation` |
| `env=` | `day`, `dusk`, `night`, `overcast` |
| `view=` | `observer`, `cam-01`…`cam-04`, `cctv-grid` |
| `present=1` | presentation view |
| `stream=0` | perception off |

## Garage

One covered deck, about 41 × 39 m. The parking area is 28.4 × 36.2 m, and the clear height is 4.2 m.

```text
z  0.0  north wall (open-deck spandrel; street and buildings beyond)
   0.4  row A  A1–A9  (9)   bays 2.6 × 5.4 m on a 2.8 m pitch, nose to the wall
   5.8  aisle 1, eastbound, 6.8 m       ← ENTRANCE (west, barrier, CLEARANCE 2.1 m)
  12.6  row B  B1–B8  (8)
  18.0  island divider (kerb, columns, CAM-01/CAM-04 bracket)
  18.2  row C  C1–C8  (8)
  23.6  aisle 2, westbound, 6.8 m       → EXIT (west, barrier, EXIT signs)
  30.4  row D  D1–D9  (9)
  35.8  walkway (STAIRS, LIFT) · 38.6 south wall
East end: turnaround joining the aisles (x ≈ 24–32) and the RAMP ↑ LEVEL 2.
```

The garage also has wheel stops, floor-stencilled bay IDs, direction arrows, a crosswalk, IN and
EXIT stencils, columns with safety-yellow bases, a ceiling with beams and pipes, 12 LED fixtures
with lights, CCTV housings, and P1 and speed signs. Bays are explicit 3D geometry in
`apps/simulator/src/showcase/layout.ts`, each with an ID, row, level, owner camera and corners.

## Cameras and ownership

| Camera | Owns | Mount (x, y, z), m | Yaw | Pitch | Vertical FOV | Output |
|---|---|---|---|---|---|---|
| CAM-01 | A1–A9 | (13.5, 3.8, 17.9), island bracket, looking north across aisle 1 | 0° | −8° | 66° | 1280×720 |
| CAM-02 | B1–B8 | (12.0, 3.8, 0.3), north wall, looking south across aisle 1 | 180° | −8° | 58° | 1280×720 |
| CAM-03 | C1–C8 | (12.0, 3.8, 35.5), south walkway, looking north across aisle 2 | 0° | −8° | 58° | 1280×720 |
| CAM-04 | D1–D9 | (13.5, 3.8, 18.1), island bracket, looking south across aisle 2 | 180° | −8° | 66° | 1280×720 |

Every bay has exactly one authoritative camera:

1. The facility config gives each camera `watches` = its owned bays only, so A2's mapping for a
   frame from camera X is computed only over X's bays.
2. `FacilityState.apply` ignores any observation of a bay from a camera that is not its sole
   watcher. This is defence in depth, and a test feeds a rogue observation.
3. `CalibrationSet` refuses two calibrations that claim the same bay.

### Why these poses (the B6-style spill)

`experiments/garage-showcase/camera-search.mjs` uses the mapper's own rule (a vehicle box covering
≥45% of a bay polygon makes it OCCUPIED). It projects a reference SUV parked in each owned bay and
in every other bay. The chosen poses have:
- **0** owned-bay pairs where one parked car's box covers ≥45% of a neighbour (worst 0.35–0.42);
- **0** cases where a car parked in another row covers an owned bay.

The first try (cameras hung over their own aisle) had 3–6 risky pairs per camera. Mounting each
camera on the far side of its aisle, looking across, removes them. That is the same ceiling height
as the 12-space garage, but shorter rows and a less oblique view.

## Calibration

`npm run calibration:showcase` (`scripts/generate-showcase-calibration.mjs`) projects each camera's
owned bays' 3D floor corners through that camera. It writes
`packages/shared/calibration/garage-showcase/{cam-01..04,facility}.json`; each camera file holds only
its owned bays, plus the image size, 3D corners and pixel coordinates. `calibration:showcase:check`
fails on drift.

## API changes (smallest possible; `main.py` untouched and still hash-pinned)

- `calibration.py`:
  - `Calibration.for_camera()`, and an optional `allowed_camera_ids` argument (default `("cam-01",)`,
    so the production loader is unchanged);
  - new `CalibrationSet` (one calibration per camera, exclusive bays, `check_facility`).
- `routes/frames.py` and `routes/perception.py` look up the calibration of the frame's own camera.
- `state.py`: bay ownership as above. For a single-camera facility it changes nothing.
- Demo mode only:
  - `PARKRIGHT_SHOWCASE_DIR` loads the set;
  - `/demo/status` gains `showcase` and `cameras` (owned bays, polygons, latest frame each);
  - new `/demo/events` (one record per processed frame: camera, vehicles ≥0.65, A2 ms, bay
    transitions);
  - `/demo/camera/latest.jpg?camera_id=`.
- A2 thresholds, the mapper, OPEN behaviour, the recommender and Nemotron are unchanged.

## Traffic

`showcase/traffic.ts` is a deterministic scheduler. Per scenario and seed it pre-computes 30
minutes of events on a one-way loop: enter west, aisle 1 east, turnaround, aisle 2 west, exit.
- **Arrivals** follow the loop and turn into a free bay.
- **Departures** reverse out (or drive out if reversed in) and follow the loop to the exit.
- **Pass-throughs** drive the loop without parking.

The scheduler reserves bays, so a bay is never targeted twice, and it spaces entries by at least
4.5 s. There is no autonomous driving: every pose is a function of (scenario, seed, t), and the
schedule repeats after 30 minutes.

| Scenario | Start | Mix |
|---|---|---|
| Live garage | 18 parked | arrivals 45%, departures 40%, passes 15%, every 5–9 s |
| Morning rush | 6 | mostly arrivals, every 3–5 s (fills to 31 in about 5 min) |
| Class transition | 26 | 150 s cycle: 60 s mostly departures, then mostly arrivals |
| Nearly full | 31 | balanced, every 6–10 s |
| Sparse | 5 | quiet, 30% passes |
| Entering vehicles | 10 | arrivals only |
| Exiting vehicles | 30 | departures only (empty after about 5 min) |
| Occlusion stress | 18 | 60% pass-throughs, all vans and pickups |
| Pass-through | 16 | passes only |
| Static validation | 16 fixed | none: the recording/validation scene |

Lighting presets are day, dusk, night and overcast; they are applied immediately. Showcase mode
forces neither the scenario nor the lighting.

## Simulator UI

- **Views:** Observer (free orbit, ceiling cut away, labelled "Observer · not sent to ParkRight",
  capped at 30 fps), CAM-01…CAM-04 (live feed, owned-bay polygons coloured by live state, A2 boxes,
  bay labels, A2 and ingest ms, frame status), and All CCTV (2×2 grid).
- **Quick views:** Overview, Entrance, Row A to D, CCTV overview.
- **Side panel:** live counts from the WebSocket; the 34-bay map, where changed bays flash; scenario
  and lighting selectors; pause, restart and perception on/off; the CCTV status table; the live
  event feed (latest 20).
- **Engineering view:** toggles for A2 boxes, polygons, owner regions (observer), ground truth
  (development only), plus FPS, sequence numbers and statuses.
- **Presentation view** (`present=1`): the same live data with less detail. An "Engineering view"
  button switches back.

The four CCTV cameras share one WebGL renderer (`showcase/cctv.ts`). Each camera renders from its
own fixed pose, its pixels are copied into its own canvas, and its JPEG is encoded from exactly
those pixels. With four contexts plus the observer, this 8 GB machine started swapping.

## Driver page

When the API is in showcase mode, the demo screen adds:
- **"Tuttle Garage · live"** (labelled "Simulated garage · live perception") with 34 / occupied /
  uncertain / confirmed open, and a 34-bay map. Changed bays flash and the source camera shows
  outside record mode. All of it updates over the WebSocket with no refresh and no button.
- **CCTV:** a camera selector with the latest frame, A2 boxes and owned polygons.
- **Live events:** real system events, camera → vehicles → bay transitions, latest 20.

The Tuttle row in the comparison shows the live count. The recommendation remains a separate
action, still uses the demo fixture's availability feed for every garage, and still returns
Tuttle Garage · Level 2 · B12.

## Results (A2 unchanged, measured on this machine: Apple M2, 8 GB)

### Static validation scene (`evidence/static-validation-comparison.txt`)

The scene has 16 parked vehicles with occupied and empty bays side by side in every row. It
includes the B6-style case: **B5 holds a pickup and B6 is empty**. Over 4 lighting presets (day,
dusk, night, overcast) × 4 cameras × 2 cycles = 32 frames, perception equalled truth in **32/32**
(0 false occupied, 0 missed, OPEN 0). The neighbour spill the 12-space garage showed (B5 → B6) does
not occur.

### Live traffic (`evidence/metrics/live-traffic-metrics.json`)

Live garage, class transition and occlusion stress, 90 s each, day, dusk and night: 376 frames,
all accepted, OPEN never reported. Frames are scored against the truth captured at the same
instant.

| Preset | Occupied precision | Occupied recall | False-occupied rate | Frames |
|---|---:|---:|---:|---:|
| Day | 0.849 | 0.913 | 0.202 | 120 |
| Dusk | 0.862 | 0.821 | 0.167 | 128 |
| Night | 0.874 | 0.801 | 0.146 | 128 |
| **All** | **0.861** | **0.843** | **0.171** | 376 |

By camera, precision / recall: CAM-01 0.89 / 0.90, CAM-02 0.83 / 0.88, CAM-03 0.82 / 0.86,
CAM-04 0.89 / 0.76. The errors are transient:
- vehicles moving in the aisle in front of a row (occlusion; CAM-04's aisle 2 carries all the loop
  traffic);
- vehicles in the middle of parking, which ground truth counts at 30% bay coverage before the box
  covers 45% of the polygon.

Recall falls at dusk and night (0.80–0.82) and in occlusion stress (0.72–0.82). The static scene
is exact in every preset.

### Performance

These are this machine's numbers, not an M5's. The M5 numbers quoted in the brief were not measured
here.

| Measure | Value |
|---|---|
| Observer view | 30 fps (capped; the animation loop runs at about 59) |
| CCTV preview | 15.4 fps; one CCTV render 2.8 ms mean |
| JPEG encode | 35–44 ms mean |
| A2 inference per camera | 2.18 s mean, 2.50 s p95 (CAM-01…04: 2176 / 2183 / 2182 / 2196 ms) |
| Camera scheduling | round robin CAM-01 → 02 → 03 → 04, one frame in flight, next frame immediately |
| Full facility refresh (all four cameras) | 9.1 s mean, 10.6 s p95 |
| Accepted frames | 0.38–0.48 fps with the observer and driver open |
| Camera → WebSocket | 2.23 s mean, 2.60 s p95 |
| Camera → driver page update | 2.56 s mean, 2.93 s p95 (observer and driver open) |

Compared with the 12-space garage on this machine (A2 about 1.9 s, 0.42 accepted fps, 13 fps
preview), A2 per frame is about 15% slower here (more vehicles per frame). Throughput is similar
(0.38–0.48 fps), and previews are faster (15 fps CCTV, 30 fps observer). Under macOS background
load (load average above 50 was seen several times) A2 slows to 4–17 s and frames can time out.
`demo:check` warns about load, and the recording checklist applies.

## Before recording: free memory

On this 8 GB machine swap was 12.2 of 13.3 GB in use: a long-running virtual machine (macOS
Virtualization framework, about 3 GB wired), Chrome, VS Code and JetBrains. Each time A2 and the
browsers started, macOS swapped and the load average jumped to 80–150; A2 then took 4–17 s and
frames went stale. Before recording:
- quit the VM and other large apps;
- check that `sysctl vm.swapusage` and `uptime` are calm;
- run `npm run demo:check`; it warns about CPU load.

## Known limitations

- Moving traffic produces transient false occupied (vehicles in front of a row) and misses
  (vehicles still parking), with live precision and recall of about 0.86 / 0.84. Only the static
  scene is exact.
- A full refresh takes about 9 s, so a bay's state is up to about 10 s old. Spaces go stale
  (UNCERTAIN) after 12 s without evidence, so a slow machine shows more UNCERTAIN.
- Single machine, CPU A2. The performance figures are M2 / 8 GB under real background load; the M5
  numbers from the brief were not measured here.
- Simulated garage, procedural vehicles; nothing here transfers to a real camera.
