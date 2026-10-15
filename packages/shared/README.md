# packages/shared

Language-neutral data shared by the API, the web app and the simulator.

- `fixtures/mvp-facility.json` — the hackathon MVP: facility `garage-01`, level `L1`, spaces A1–A6 and
  B1–B6, camera `cam-01` watching all twelve. Validated against `FacilityConfig`
  (packages/contracts). `plan` rectangles are normalised level-plan coordinates (origin top-left),
  for drawing the lot. They describe the site, not which spaces are occupied.

Camera `polygons` (space outlines in the camera image) are calibration. They stay empty until the
virtual camera's view is fixed, and only a detector needs them.
