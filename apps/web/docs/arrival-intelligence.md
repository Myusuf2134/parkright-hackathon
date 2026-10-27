# Arrival Intelligence — what's real, what's demo, and how to connect it

ParkRight answers two questions: **Explore — where should I park?** and **Plan — when should I leave?**
Plan's answer comes from a small, pure engine (`src/driver/arrival/engine.ts`) fed by typed inputs
(`src/driver/arrival/types.ts`). Today only one input is live.

| Input | Today | Label in the UI |
| --- | --- | --- |
| Parking near class (open / occupied / can't confirm, freshness) | **Live** from the ParkRight API and WebSocket (a simulated garage in the hackathon) | Live · simulated |
| Next class, building, start time | Demo fixture (`/api/v1/demo/scenario`) or the built-in default | Demo |
| Drive time, walk time, parking time, buffer | Demo estimates | Demo estimate / Estimated |
| Traffic, weather, roadwork, announcements | Typed demo scenarios (`scenarios.ts`) with generic road names | Demo |
| Notifications | In-app only, while the app is open | "Push notifications: Not available" |

Nothing on Plan is current real-world information except parking. No coordinates are invented: the
map is an illustration and routes are named legs ("Highway leg"), not geometry.

## The engine

1. **Relevance.** Every signal is judged by five checks and shown only if all pass:
   fresh (`minutesOld ≤ maxAgeMin`), trusted (`confidence ≥ 0.6`), on the route or about the
   student's own class/building, overlapping the travel window, and meaningful (≥ 3 min, or it
   cancels/moves the class, or it changes where they can park). Every check keeps its reason, which the
   "updates checked · not relevant" list shows.
2. **Departure.** `leave = class start − drive − park − walk − buffer`, where relevant weather and
   roadwork add drive/walk minutes and **traffic is added only when the drive estimate does not
   already include live traffic** (`etaIncludesTraffic`). A cancellation means no departure; a room
   change swaps the building and walk time; a missing drive estimate means "Not available", never a
   guess. No confirmed parking never makes the advice later: the parking estimate stays and the
   student is told to allow extra time.
3. **Deterministic.** Same inputs, same output. `engine.test.ts` (18 tests) and `e2e/arrival.spec.ts`
   pin the behaviour.

## Connecting real sources (requires separate approval; not built)

Each source becomes a producer of `ClassSession`, `PlannedRoute` or `Signal`. The engine and UI do not change.

| Source | What it would provide | Requirements before it can be live |
| --- | --- | --- |
| University schedule (e.g. SIS / LMS calendar) | `ClassSession` per upcoming class | Institutional agreement, OAuth/SSO sign-in, student consent, FERPA review, server-side token storage, revocation |
| Official class/instructor announcements | `Signal{kind:'announcement', effect}` | Authorized announcement API or LMS webhooks scoped to the student's courses; source verification; dedupe |
| Weather provider | `Signal{kind:'weather'}` with drive/walk impact | Commercial API key held server-side; mapping of forecast severity to minutes; freshness ≤ 90 min |
| Traffic / routing provider | `PlannedRoute.driveMinutes` (with `etaIncludesTraffic: true`) and incident `Signal`s on route legs | Real origin (student-provided or location permission), route geometry, provider ToS; when ETA includes traffic, incidents are explanations, not extra minutes |
| Roadwork / municipal feeds | `Signal{kind:'construction'}` on legs/entrances | City/state feed ingestion, geometry matching to the route, validity windows |
| Parking availability | already live (`/api/v1/facilities`, `WS /api/v1/realtime`) | More facilities with surveyed locations and per-garage walking times |
| Background monitoring | Re-evaluating the engine as signals change | A server-side scheduler per planned trip; rate limits; battery-neutral on device |
| Push notifications | "Leave in 15 minutes", "your space was taken" | Web Push (VAPID) or native wrapper, opt-in permission, server sender, quiet hours, and an honest preference UI (today it says "Not available") |

Until a source is connected, its values keep the **Demo**, **Estimated** or **Unavailable** label.
