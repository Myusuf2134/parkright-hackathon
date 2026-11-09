# Meridian Your Day — grounded, private V1

## Scope

This is a narrow and reversible foundation for the future Your Day Agent, not a fully autonomous AI agent. It does **not** invoke an LLM, make background requests for student records, generate imaginary assignments, or monitor private GPS.

The currently connected sources are:

| Surface | Source | Truth label |
|---|---|---|
| Class time / building | Student manually enters it | "Entered by you"; **not** school-verified |
| Weather | Official National Weather Service forecast for a fixed Ohio State campus point | "Forecast"; provider URL and check time; unavailable on error |
| Parking | Existing Meridian facility feed | "Simulated" where applicable; unavailable if no trusted evidence |
| Route and leave-by time | Existing Explore routing UI (linked by button) | No new estimate unless real routes and parking/walk timing are available |
| Assignments and announcements | No connected provider | Unavailable; never invent |
| Roadwork / live traffic | No connected official feed | Unavailable; never invent |

Weather is fetched by a server-side read-only GET /api/v1/your-day/campus-weather. The endpoint does **not** accept user coordinates, query parameters, class details, or identity. It always queries a fixed campus point, follows **no redirects**, validates that the forecast URL is under api.weather.gov, caches successful results for 10 minutes, and rate-limits failures with a 60-second cache. The API does not accept secrets.

## How to test

Work on the isolated branch: feat/meridian-your-day-agent-v1. **Do not overwrite any uncommitted local work.**

In the repository root:

    uv sync
    npm install
    uv run pytest services/api/tests/test_your_day.py
    cd apps/web && npm test -- --run src/driver/yourDay/model.test.ts
    npm run typecheck
    npm run build

Return to the repository root and launch your existing demo:

    npm run demo:student -- --lan

Open /app/ → Plan → "Use my own classes · Private". Add a course, building and date/time; the class appears under "Entered by you." The weather entry either displays the NWS sourced forecast or "unavailable"; it must never display a guessed number. Turn on "Remember classes on this device" only on a private phone. Clear them with "Clear classes and device storage".

## Privacy contract

- The manually entered class list remains in component memory unless the student opts into localStorage. It is not sent to the Meridian API, the NWS, an LLM, analytics, or another student.
- The UI offers a visible clear/delete control. Browser storage is *not encrypted*: do not use the persistence option on a shared device.
- Public Cloudflare Quick Tunnels are **not appropriate for real student-account OAuth or any actual Canvas tokens**. Use stable production hosting with per-user authentication before adding such integrations.
- The forecast API sees the visitor's ordinary request metadata (as with any website), but never the student's schedule or GPS.
- No location permission is requested by this view, no student-provided credential is collected, and no "AI analysis" is performed on educational records.
- No departure recommendation is made without complete route/parking/walking inputs. Never reuse the demo scenario's minutes as verified.

## Next stages

1. Connect real route + walk estimates to a **pure deterministic** departure calculation; keep missing data as "unavailable".
2. Design authenticated, tenant-isolated user accounts, consent toggles, export and deletion procedures, and retention policies before storing private data server-side.
3. Request OSU authorization for a **read-only**, scoped Canvas OAuth developer key. Canvas scopes and refresh tokens must be handled server-side, encrypted at rest, isolated by account, and revocable. Never ask users for their OSU password. Before authorization, assignment/announcement cards remain unavailable.
4. Add official campus construction / closures data only when a trustworthy feed exists; show source timestamps and expiration.
5. Only then add optional AI phrasing/interpretation of a **minimized** factual summary, behind explicit consent, allowlisting and strict structured-output checks. AI is not allowed to supply new facts, changes to deadlines, or invented traffic/parking.
6. Add alert permission controls and opt-in scheduled notifications, with quiet hours and revocation.

## Security review before merging

Run regression, mobile WebKit, privacy/retention tests, dependency audits, and live NWS checks. Confirm no classes appear in browser network requests or logs; validate XSS-safe rendering of user-entered course/building names; ensure the NWS endpoint does not introduce an SSRF escape route; ensure the endpoint remains independent of the camera pipeline; and verify old Plan demo behavior is unchanged.

**Not production-ready.** Do not merge or deploy without human review.
