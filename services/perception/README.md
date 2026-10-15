# services/perception — `parkright_perception`

```
Frame (FrameMetadata + JPEG bytes) ─▶ PerceptionProvider.infer(frame, view) ─▶ SpaceInference[]
                                   ─▶ to_observations() ─▶ OccupancyObservation[]
```

- `provider.py` — the `PerceptionProvider` protocol. A provider gets one frame and the spaces its camera
  watches (with image polygons once calibrated). Nothing else.
- `normalize.py` — enforces the safety rules: one observation per watched space; missing, duplicate or
  invalid answers become UNCERTAIN; weak OPEN and unscored OCCUPIED become UNCERTAIN; provenance is
  attached by the pipeline.
- `providers/uncertain.py` — `none`, the default: everything UNCERTAIN.
- `registry.py` — where detector arms (experiments/a0…a3) register.

Runs in-process with the API today. A remote GPU deployment (Nebius) is a provider that forwards the
frame to an inference endpoint; the API and the camera contract stay the same.

This package must never import `parkright_evaluation`. The tests check that.
