# Ohio Union North Garage-inspired simulation

Branch `feat/ohio-union-garage` (base `feat/garage-showcase` e047926). It adds a second showcase site: one large level of
a campus parking deck, **inspired by** the Ohio Union North Garage. **It is not an official or exact digital twin:** the bay
count, dimensions, column grid, ramps, cameras and traffic are invented for the simulation, and no real OSU data is used. The
site says so everywhere it is named (simulator header, driver page, facility name, `site.json`).

The 34-space showcase is unchanged and remains the recording fallback (`npm run demo:showcase`). The new site reuses its
engine (world, lab, CCTV rig, streamer, UI) through a small `Site` abstraction. The 34-space traffic schedules are
byte-identical to before (a SHA-256 fingerprint is pinned in `apps/simulator/test/ohio.test.ts`).

A2 was not retrained, no perception threshold was changed (occupied ≥ 0.65 confidence, ≥ 0.45 coverage), and **OPEN stays
disabled**.

## Run it

```sh
npm run demo:ohio -- --open             # API (A2, eight calibrations) + simulator + driver app
# Simulator:  http://127.0.0.1:5181/?sim=ohio-union&present=1
#   (same as  http://127.0.0.1:5181/?showcase=1&sim=garage&site=ohio-union)
# Driver:     http://127.0.0.1:5180/?record=1
npm run demo:check                      # 8/8 cameras reporting, 72 bays, OPEN disabled (see "Recommendation" below)
npm run calibration:ohio:check          # calibrations match the layout (drift check)
```

URL parameters are the showcase's: `scenario=` (`live`, `morning-rush`, `class-transition`, `nearly-full`, `sparse`,
`entering`, `exiting`, `occlusion-stress`, `pass-through`, `validation`), `env=` (`day`, `dusk`, `night`, `overcast`),
`view=` (`observer`, `cam-01`…`cam-08`, `cctv-grid`), `present=1`, `stream=0`.

Before recording on the 8 GB M2: free memory first (quit the long-running VM and large apps), as for the 34-space showcase.

## The level

```text
z  0.0  north wall: open-deck spandrel with cable rails; campus street, trees, brick buildings beyond
   0.4  row A   A1–A9  │ spine │  A10–A18     bays 2.6 × 5.4 m, 2.8 m pitch
   5.8  aisle 1, eastbound  ← ENTRANCE gate (west): kiosk, raised barrier, CLEARANCE 7'-0" bar
  12.6  row B   B1–B9  │       │  B10–B18
  18.0  island (column line, girder, CAM-01/04 and CAM-05/08)
  18.2  row C   C1–C9  │       │  C10–C18
  23.6  aisle 2, westbound  → EXIT gate (west)
  30.4  row D   D1–D9  │       │  D10–D18
  35.8  walkway: stair and lift lobbies, crosswalks · 38.6 south wall

x  −4 west wall · 1.0–26.0 west module · 26.4–33.0 spine (one-way south) · 33.4–58.4 east module
   59–65 east turnaround (south) · 65.6–72.4 two-way ramp to level 2 (through the slab) · 73 east wall
```

- **72 bays**, rows A–D of 18. Bays 1–9 are west of the spine, bays 10–18 east. The spine is a one-way southbound shortcut
  from aisle 1 to aisle 2.
- **Low precast deck.** The slab soffit is at 3.7 m, girders on the column lines hang to 3.1 m, and double-tee stems hang to
  3.28 m. There are sprinkler and conduit runs and an LED fixture grid. The 34-space garage is 4.2 m clear.
- **Openings and exterior.** The north and east sides are open above a 1.05 m spandrel, and the gates are on the west.
  Daylight comes in through the openings, so the entrances read brighter than the interior.
- **Column grid** every three bays, at the spine and at the ramp bay. The columns have safety-yellow bases and row markers.
- **Ramp** to level 2, with up and down lanes, parapets, a centre kerb, UP/DOWN paint and a "RAMP · LEVELS 2–5" sign. Vehicles
  on the ramp follow its slope.
- **Wayfinding and wear.**
  - Floor paint: arrows, ENTER, EXIT, SLOW, STOP, ONE WAY.
  - Hanging row signs, for example "ROW B · 10–18".
  - One stencil per bay, wheel stops, worn drive lanes, tyre marks, oil stains and expansion joints.

## Cameras and ownership

Eight fixed CCTV cameras, 1280×720. Each owns **one half-row of 9 bays exclusively**, so every bay has exactly one owner.
Each camera is mounted at 3.2 m on the face of a girder on the far side of its row's aisle, looking across at the row
(pitch −8°, vertical FOV 62°).

| Camera | Owns | Mount |
|---|---|---|
| CAM-01 | A1–A9 | west island girder, north face |
| CAM-02 | B1–B9 | north girder, south face |
| CAM-03 | C1–C9 | south girder, north face |
| CAM-04 | D1–D9 | west island girder, south face |
| CAM-05 | A10–A18 | east island girder, north face |
| CAM-06 | B10–B18 | north girder, south face |
| CAM-07 | C10–C18 | south girder, north face |
| CAM-08 | D10–D18 | east island girder, south face |

`experiments/ohio-union-garage/camera-search.mjs` checks the poses by the mapper's rule, using a reference SUV box:

- 0 owned-bay neighbour-spill pairs (worst coverage 0.43, against the 0.45 rule);
- 0 cases where a car in a bay the camera does not own covers an owned bay;
- every owned bay in frame, and at least 83% covered by its own car.

Ownership is enforced as on the 34-space site: each camera's calibration holds only its bays, the API refuses overlapping
calibrations, and facility state ignores updates from a camera that does not own the bay.

`scripts/generate-ohio-calibration.mjs` projects each camera's owned bay corners and writes these files to
`packages/shared/calibration/ohio-union/`:

- `cam-01…08.json`;
- `facility.json` (facility `garage-01`, 72 spaces);
- `site.json` (the demo label and disclaimer).

`--check` fails on drift.

## Traffic

Deterministic: everything at sim time t is a function of (site, scenario, seed, t). The shared scheduler
(`showcase/schedule.ts`) never assigns a bay twice and spaces gate entries at least 4.5 s apart.

**Routes** (`ohio/traffic.ts`):

- **Arrivals:**
  - rows A and B are reached from aisle 1;
  - west-module C and D bays through the spine;
  - east-module C and D bays round the east turnaround.
- **Departures** reverse out (or drive out) and leave by the spine or the turnaround.
- **Pass-through** traffic takes one of four routes:
  - the full loop;
  - the spine;
  - up the ramp;
  - down the ramp and out.

Ramp and spine traffic passes in front of the cameras. That is the extra occlusion the 34-space garage lacked.

**Scenario sizes:** live starts with 38 cars, morning rush 12, class transition 54, nearly full 66, sparse 10. The static
validation scene has 34 cars, with large vehicles beside empty bays in every half-row.

## Measured (live A2, Apple M2 8 GB; not an M5)

Evidence: `experiments/ohio-union-garage/evidence/`.

**Static validation scene** (four presets × eight cameras × two cycles = 64 frames):

- **Precision 1.00:** no false OCCUPIED in any frame.
- **Recall 0.93:** 18 of 272 occupied bay-observations missed.
- **OPEN reported:** 0.
- **Frames exactly equal to truth:** 48 of 64.

Every miss leaves the bay UNCERTAIN:

- **B10 from CAM-06** is partly hidden by the SUV in B11 at that oblique angle. A2 sees it at 0.56 confidence (below 0.65).
- **The others** are dark cars in the far row at dusk and night.

This is weaker than the 34-space site's exact 32/32: these cameras are lower and see more occlusion.
`static-validation-comparison.txt` records how the mounting height was chosen (2.8 m → recall 0.79 with 3 false OCCUPIED;
3.0 m → 0.85; 3.2 m → 0.93 with no false OCCUPIED). Stall lights over the perimeter rows were tried and dropped: recall rose
to 0.95, but they caused 2 false OCCUPIED.

**Live traffic** (live and occlusion-stress scenarios, day/dusk/night, 224 frames, all accepted, OPEN never reported):

| Lighting | Precision | Recall | False-occupied rate |
|---|---:|---:|---:|
| Day | 0.90 | 0.86 | 0.10 |
| Dusk | 0.94 | 0.79 | 0.06 |
| Night | 0.91 | 0.75 | 0.08 |
| All | 0.92 | 0.80 | 0.08 |

For reference, the 34-space site's live run measured precision 0.86, recall 0.84 and a false-occupied rate of 0.17. The two
runs used different scenarios and loads, so this is not a controlled comparison.

**Performance** (`evidence/performance.json`):

- **Rendering:** observer 30 fps (capped); CCTV preview 15.3 fps; one CCTV frame renders in 4.1 ms (1,186 draw calls,
  mostly vehicles); JPEG encoding takes 58 ms on average.
- **A2:** 2.13 s per frame (2.56 s at the 95th percentile), 0.38 accepted frames per second.
- **Refresh:** a full eight-camera cycle takes 18.1 s (20.2 s at the 95th percentile).
- **Latency:** camera to WebSocket 2.19 s; camera to driver page 2.53 s.

## Freshness and the recommendation

Eight cameras share one A2 in round robin, so each bay is re-observed only every ~18 s on this machine.

- **Freshness window.** `demo:ohio` sets the facility freshness window to 30 s (`PARKRIGHT_STALE_AFTER_MS=30000`; the
  default is 12 s), so bays do not flicker UNCERTAIN between visits. This is the state's evidence-age window, not an A2 or
  mapper threshold, and the 34-space site keeps 12 s.
- **Recommendation.** The recommendation keeps the product rule unchanged: it needs evidence no older than 12 s
  (`MAX_AGE_SECONDS`). On this machine the oldest Ohio bay is always ~16–18 s old, so **"Find my parking" answers "No
  confirmed parking right now"** in Ohio mode, and `demo:check` reports a WARN for it. To record the recommendation, use
  `npm run demo:showcase`.
- **Driver page.** It never attaches the Ohio site's live counts to the Tuttle row, because the Ohio site is not Tuttle.

## Tests

- **Simulator:** `apps/simulator/test/ohio.test.ts`, 20 tests covering:
  - layout and the low deck;
  - the ramp;
  - ownership and projection;
  - drift for both sites;
  - the spill check;
  - determinism and scheduler invariants;
  - routes and the validation scene;
  - site parsing;
  - the 34-space fingerprint.
- **API:** `services/api/tests/test_ohio_union_garage.py`, 8 tests covering:
  - eight calibrations and half-row ownership;
  - 72-space aggregation;
  - the WebSocket;
  - the site label;
  - ground-truth isolation;
  - the unchanged 34-space status;
  - OPEN disabled.
- **Browser:** `scripts/showcase/ohio.spec.ts`, 4 tests against the running stack:
  - real uploads from eight cameras, with no ground truth;
  - CCTV views;
  - scenario and lighting switching;
  - the driver page.

## What remains

- **Recommendation in Ohio mode** needs either faster A2 (GPU or a faster machine), fewer cameras per A2, or a decision
  about the freshness rule. I did not change that rule.
- **Recall at dusk and night** in the far rows, and oblique occlusion at the edges of each half-row (B10). Options: more
  cameras with fewer bays each, or different mounts. A2 is unchanged.
- **Single level.** Level 2 and above exist only as the ramp's destination.
- **Vehicles** are the simulator's procedural models. There is no contact-shadow pass.
