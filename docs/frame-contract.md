# Camera Frame Contract v1

The boundary between any camera (the virtual simulator camera now, physical cameras later) and the
ParkRight backend. **The backend's responsibility begins at a JPEG plus five metadata fields.**
Perception happens in the backend. A camera never says whether a space is occupied.

Source of truth: the Pydantic models in `packages/contracts/src/parkright_contracts/`.
JSON Schema: `packages/contracts/schema/contracts.schema.json`. TypeScript: `@parkright/contracts`
(`packages/contracts/ts`). Regenerate both with `npm run contracts:generate`; tests fail if they drift.

```
virtual camera ─▶ JPEG + FrameMetadata ─▶ POST /api/v1/cameras/{camera_id}/frames
                                             │ auth · size · type · parts · metadata · ordering
                                             ▼
                                        PerceptionProvider      (none today; A0 / A1 / A2 / A3 later)
                                             │ SpaceInference[] → to_observations() → OccupancyObservation[]
                                             ▼
                                        FacilityState ──▶ WS /api/v1/realtime  (occupancy_update)
                                                     └──▶ GET /api/v1/facilities/{id}/spaces

simulator ground truth ─▶ POST /api/v1/evaluation/ground-truth   (own store; never reaches the above)
```

## Sending a frame

```
POST /api/v1/cameras/{camera_id}/frames
Authorization: Bearer <PARKRIGHT_INGEST_TOKEN>
Content-Type: multipart/form-data

  part "metadata"  FrameMetadata as JSON (a text field, or a JSON blob part)
  part "image"     the JPEG, Content-Type image/jpeg, ≤ PARKRIGHT_FRAME_MAX_BYTES (default 2 MiB)
```

```json
{
  "session_id": "sim-2026-10-14T10-00-00",
  "camera_id": "cam-01",
  "seq": 412,
  "sim_time_ms": 41200,
  "captured_at": "2026-10-14T10:00:41.200Z"
}
```

| Field | Rule |
| --- | --- |
| `session_id` | One run of this camera's stream. **Use a new one whenever `seq` restarts** (camera restart, simulation reset). |
| `camera_id` | Must equal `{camera_id}` in the URL and be a camera configured for a facility. |
| `seq` | Integer ≥ 0, strictly increasing within (`camera_id`, `session_id`). Gaps are allowed. |
| `sim_time_ms` | Integer ≥ 0, non-decreasing within a session. Physical cameras: ms since stream start. |
| `captured_at` | ISO-8601 with `Z` or an offset. Only used to detect stale frames, never for ordering. |

Identifiers: 1–64 characters of `A–Z a–z 0–9 . _ -`, starting with a letter or digit, never `..`.

**Nothing else is accepted.** Metadata with any other key is rejected, and so is any multipart part
other than `metadata` and `image`: no occupancy, labels, vehicle positions, simulator state or ground
truth.

Examples: `scripts/test_camera.py` (Python/httpx). In a browser:

```ts
const form = new FormData();
form.append('metadata', JSON.stringify(metadata));
form.append('image', jpegBlob, 'frame.jpg');           // canvas.toBlob(cb, 'image/jpeg', 0.85)
await fetch(`/api/v1/cameras/${metadata.camera_id}/frames`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
```

### Responses

`202` = processed. `200` = received, deliberately not processed. Either way the body is a `FrameIngestResult`.

| `outcome` | When | Effect |
| --- | --- | --- |
| `accepted` | New, in order, recent | Perception ran; state updated; `occupancy_update` published. Body has `observations`. |
| `duplicate` | Same `seq` as the last processed frame of this session | Nothing. Safe to retry. |
| `out_of_order` | `seq` below one already processed in this session | Dropped; newer state is never overwritten. |
| `stale` | In order, but `now − captured_at > PARKRIGHT_FRAME_MAX_AGE_MS` (10 s) | `seq` recorded, state untouched. |
| `superseded_session` | From a session this camera has since replaced | Dropped. |

`gap` = how many `seq` values were skipped since the previous processed frame.

| Status | `error.code` |
| --- | --- |
| 400 | `missing_metadata`, `missing_image`, `invalid_metadata` (with `details`), `camera_mismatch`, `unexpected_part`, `duplicate_part`, `validation_failed` (bad `camera_id` in the URL) |
| 401 | `unauthorized` — missing or wrong ingest token |
| 404 | `unknown_camera` |
| 409 | `sim_time_regressed` — `sim_time_ms` went backwards while `seq` advanced (a producer bug) |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` — not multipart; image part not `image/jpeg`; bytes not a JPEG |
| 503 | `perception_timeout` — the frame was *not* recorded; retrying the same `seq` is safe |

Ordering state lives in the API process. After an API restart, each camera's next frame starts its
stream again. One camera's frames are processed one at a time, in arrival order.

**Clocks:** the camera's and the API's wall clocks must agree to within `FRAME_MAX_AGE_MS`, or every
frame comes back `stale` (the `detail` says by how much). Space freshness uses the API's receive time,
so skew never makes old evidence look new.

## Occupancy semantics

`OPEN` · `OCCUPIED` · `UNCERTAIN`. **Only `current_state: "OPEN"` with `stale: false` is availability**
(`is_confirmed_available` / `isConfirmedAvailable`). Enforced in the backend:

- an `OPEN` without confidence ≥ 0.5 (`MIN_OPEN_CONFIDENCE`) becomes `UNCERTAIN`;
- an `OCCUPIED` without a confidence becomes `UNCERTAIN` (confidences are never invented);
- a space the provider skipped, repeated, or scored with an invalid confidence becomes `UNCERTAIN`,
  not its previous state;
- a space never observed is `UNCERTAIN` (`last_observed_at: null`);
- a space not observed for `PARKRIGHT_STALE_AFTER_MS` (12 s) is `UNCERTAIN` with `stale: true` —
  computed at read time, so it never depends on a background job;
- the default provider (`PARKRIGHT_PERCEPTION_PROVIDER=none`) reports everything `UNCERTAIN`.

The web app also offers only `designation: "standard"` spaces, and shows every space `UNCERTAIN`
while its realtime connection is down.

## Reading occupancy (public, read-only)

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/health` | Status, frame contract version, active perception model, evaluation on/off |
| `GET /api/v1/facilities` | `Facility[]`: levels, cameras (online, last frame), counts |
| `GET /api/v1/facilities/{facility_id}` · `/levels` | `Facility` · `Level[]` |
| `GET /api/v1/facilities/{facility_id}/spaces[?level_id=L1]` | `FacilityOccupancy` |
| `GET /api/v1/facilities/{facility_id}/spaces/{space_id}` | `ParkingSpace` |
| `WS /api/v1/realtime?facility_id=garage-01` | `facility_snapshot` once, then `occupancy_update` after every accepted frame and when evidence goes stale. Each update carries every space. |

OpenAPI: `http://127.0.0.1:8400/api/v1/docs`.

## Ground truth (evaluation only)

```
POST /api/v1/evaluation/ground-truth      Authorization: Bearer <PARKRIGHT_INGEST_TOKEN>
GET  /api/v1/evaluation/ground-truth?camera_id=cam-01&session_id=…
```

```json
{ "session_id": "sim-…", "camera_id": "cam-01", "seq": 412, "sim_time_ms": 41200,
  "environment_preset": "rain_night",
  "spaces": [{ "space_id": "A1", "truth": "occupied" }, { "space_id": "A2", "truth": "empty" }] }
```

Send it with the same `(camera_id, session_id, seq)` as the frame it describes, as a separate request.
Lower-case `occupied` / `empty` on purpose: it cannot be parsed as an observation, or vice versa.

Isolation is enforced, not just documented (`services/api/tests/test_ground_truth_isolation.py`):
frames carrying ground truth are rejected; providers receive only `Frame(metadata, jpeg)`; recording
ground truth leaves parking state untouched; no production-path module imports `parkright_evaluation`;
with evaluation off (the production default) the package is never even loaded and the route is 404.
