# Simulator — PARKRIGHT VISION LAB

`apps/simulator`. React + TypeScript + three.js / React Three Fiber.

```
SceneSpec (seed · occupancy · preset · camera pose) + sim time
   │
   ▼ src/sim/World            pure TS: vehicles, manoeuvres, seeded traffic, ground truth
   ▼ src/scene/*              three.js deck, lights, vehicles   (operator overlays on layer 1)
   ▼ src/camera/VirtualCamera cam-01: own WebGLRenderer + canvas, renders layer 0 only
   ▼ canvas.toBlob('image/jpeg')
   ├─▶ src/stream/frameUpload   POST /api/v1/cameras/cam-01/frames   metadata + JPEG, nothing else
   └─▶ src/evaluation/groundTruth  POST /api/v1/evaluation/ground-truth  (separate request)
```

## Environment

A rooftop parking level, 20 × 20 m bay area (1 plan unit = 20 m, from
`packages/shared/fixtures/mvp-facility.json`): 12 bays of 2.6 × 6.0 m in two nose-in rows either side of
a 4.8 m aisle. It has painted lines, wheel stops, aisle arrows, concrete parapets with a guard rail,
five lamp posts, a stair core, cam-01's mounting pole and a city skyline for depth. Procedural vehicles
come in five styles (sedan, hatchback, SUV, pickup, van) with a real-world colour mix and small parking
offsets.

Presets: **Clear Day, Overcast, Dusk, Night** (`src/sim/presets.ts`). Each maps to the canonical
`EnvironmentPreset` contract, which is sent with ground truth. Adverse effects (rain, fog, snow, sun
glare, harsh shadows, lens dirt, partial occlusion, low/high exposure) have a typed slot (`effects`) and
a registry in `src/scene/effects.ts`. None is implemented yet. An effect may change pixels only.

## cam-01

A fixed camera on a pole south of the deck. The default mount is (10, 10.5, 25.5) m, pitch −33°, FOV 52°,
1280×720. A unit test projects every corner of all 12 bays through it. Position, yaw/pitch/roll, FOV and
resolution (640×360 to 1920×1080) are adjustable in the CAM-01 MOUNT panel and saved in the scene link.

`VirtualCamera` owns a separate `WebGLRenderer` and `<canvas>`. The CAMERA FEED panel shows that canvas.
Each frame is `canvas.toBlob('image/jpeg', 0.85)` of those same pixels. There is no second, simplified
image.

## Determinism

- All randomness goes through `src/sim/prng.ts`, keyed by `(seed, purpose, …)`. `src/sim` and
  `src/scene` contain no `Math.random`, `Date.now`, `performance.now` or `new Date(`, and a test
  enforces that.
- A vehicle is a pure function of `(seed, space, nonce)`. Randomize *n* for a seed always gives the
  same layout. Traffic events are keyed by whole simulated seconds, so they don't depend on frame rate.
- The scene link (`#seed=…&env=…&occ=A1.0,B3.2&cam=…`) reproduces the scene exactly. The browser test
  checks that the same link renders **byte-identical JPEGs**, even after a page reload, on the same
  machine and GPU. Different GPUs may round differently.
- Time moves only when playing (wall dt × speed 0.5/1/2/4) or on Step (+500 ms). Pausing freezes
  `sim_time_ms`; `captured_at` is always the real wall-clock capture time.

A future batch renderer needs no UI: `new Lab(spec)` → `attach(new Scene())` → `captureFrame()` gives a
JPEG plus the ground truth for the same instant.

## Streaming

STREAM OFF / 1 / 2 / 5 FPS, or **Capture & send** for one frame. Per frame:

1. sync the scene to the world, render cam-01, read ground truth (one synchronous step);
2. encode the JPEG;
3. build `FrameMetadata` (`session_id`, `camera_id`, `seq`, `sim_time_ms`, `captured_at`);
4. `POST /api/v1/cameras/cam-01/frames`;
5. if the API reports evaluation enabled and the operator toggle is on, `POST` ground truth separately
   for the same `(session_id, seq)`.

`seq` goes up by one for every captured frame in a session, whether or not the upload succeeded.
Failed frames are never re-sent. If an upload is still in flight when the next tick fires, that tick is
skipped (counted in the frame log). A new `session_id` starts on Reset, a new seed, a loaded scene link,
**New session**, or whenever sim time would go backwards. If the API is unreachable, the lab keeps
running, shows **API DISCONNECTED**, logs `disconnected`, and the next frames simply try again. The
frame log shows each result: `accepted`, `duplicate`, `out_of_order`, `stale`, `superseded_session`,
`rejected` (4xx/409) or `error`.

## Ground-truth isolation

What a frame request can contain is pinned, not just documented:

| Guard | Where |
| --- | --- |
| `frameUpload.ts` imports nothing but `@parkright/contracts` | `test/isolation.test.ts` |
| Metadata must be exactly the 5 keys, typed; a fresh object is serialised | `assertCanonicalMetadata`, unit tests |
| Exactly two multipart parts; constant filename `frame.jpg`; no query string; no custom headers | unit + browser tests (bytes captured as the browser sent them) |
| JPEG has no comment (FFFE) or EXIF/APP1 (FFE1) segments | browser test |
| Overlays on layer 1; cam-01 renders layer 0 only; labels are DOM | unit test + browser test (`layers.mask === 1`) |
| `src/sim` and `src/scene` never import networking | unit test |

Ground truth is labelled in the UI as **SIMULATOR GROUND TRUTH — NOT PROVIDED TO PERCEPTION**, next to
the backend's own view of each bay. With the `none` provider the backend shows every bay UNCERTAIN.
That is correct, and the browser test asserts it.
