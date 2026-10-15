# ParkRight — NVIDIA × Nebius Global AI Hackathon

Camera-based parking intelligence. Infrastructure cameras watch parking spaces; perception decides
which are **OPEN**, **OCCUPIED** or **UNCERTAIN**; drivers see live availability and pick a legal open
space. Nothing is installed in the driver's vehicle.

For the hackathon the car park is virtual, but the pipeline is the one a real deployment would run:

```
virtual parking environment ─▶ virtual camera ─▶ JPEG frame
   ─▶ POST /api/v1/cameras/{camera_id}/frames ─▶ PerceptionProvider (NVIDIA model)
   ─▶ occupancy state ─▶ realtime (WebSocket) ─▶ driver UI
```

**Simulator ground truth never enters that path.** It goes to `/api/v1/evaluation/ground-truth` and
is used only to score perception.

Status: backend foundation. See [docs/](docs/).
