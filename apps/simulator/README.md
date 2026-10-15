# apps/simulator — virtual parking environment

Owned by the simulator workstream. The backend does not depend on anything in this directory.

## Its only obligation to the backend

Render the 12-space facility, capture what the virtual camera sees as a JPEG, and send it:

```
POST /api/v1/cameras/{camera_id}/frames
Authorization: Bearer $PARKRIGHT_INGEST_TOKEN
multipart/form-data:  metadata = FrameMetadata JSON,  image = JPEG (image/jpeg)
```

See [docs/frame-contract.md](../../docs/frame-contract.md). Facility geometry (space ids, plan layout,
camera id) is in [packages/shared/fixtures/mvp-facility.json](../../packages/shared/fixtures/mvp-facility.json).

Ground truth (which spaces the simulator filled) goes **only** to `POST /api/v1/evaluation/ground-truth`,
never with a frame.

## Suggested stack (not binding)

Vite + TypeScript + Canvas 2D, a seeded PRNG for deterministic scenes, `canvas.toBlob(cb, 'image/jpeg', q)`
for capture. Types: `@parkright/contracts` (packages/contracts/ts).
