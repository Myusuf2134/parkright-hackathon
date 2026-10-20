# Nemotron parking recommendations

Isolated feature branch `feat/nemotron-recommendation`, based on integration commit `255026a`. No occupancy, calibration, thresholds, OPEN policy or shared contracts changed.

## Separation of responsibilities

Perception turns camera pixels into occupancy. This service turns caller-supplied structured parking facts into advisory recommendations. It never writes occupancy or offers an individual space. The driver panel supplies only fresh, confirmed OPEN standard spaces as availability; UNCERTAIN is never counted. Simulated facilities are explicitly labelled.

Nemotron selects a supplied facility and factual reason codes. Python validates that selection and renders a concise explanation using only supplied values. Unrestricted model prose is **never** shown to the driver. Successful provenance means a validated Nemotron selection, not Nemotron-authored free prose. Missing values are reported as unknown, not imputed.

## Run locally

From this worktree:

```sh
uv sync --frozen --group dev
npm ci --ignore-scripts
# Export NEBIUS_API_KEY securely in this shell, without pasting it into source or commands saved in history.
# If omitted, recommendations use the explicitly labelled local fallback.
PARKRIGHT_PERCEPTION_PROVIDER=none uv run --frozen python -m parkright_api
```

In another terminal, `npm run dev:web`. API defaults to 127.0.0.1:8400; Vite proxies `/api` to it. Open a facility and use **Get recommendation**. No automatic paid calls occur per frame. No fresh camera frame disables the button. With frozen A0 OPEN disabled, no availability is fabricated: the panel will explain that no space is confirmed available rather than call Nemotron.

`NEBIUS_API_KEY` is read only from the backend process environment, not from browser variables. The recommendation client does not independently load `.env`; export the key through your process/secrets manager. Neither request headers, provider response bodies, nor exceptions containing credentials are logged.

## Endpoint and schemas

`POST /api/v1/recommendations` accepts up to ten facilities and optional `destination`. It returns HTTP 200 for both a successful recommendation and an explicitly identified fallback. Invalid input uses the existing API's HTTP **400** validation envelope. Bodies over 16 KiB receive 413.

Each facility requires:

- `facility_id`: unique identifier, 1–80 ASCII letters/digits/underscores/hyphens.
- `name`: 1–120 characters.
- `total_spaces`: integer 1–100000.
- `observed_at`: timezone-aware ISO timestamp.

Optional fields: `available_spaces` (nonnegative integer or null), `occupancy_percentage` (0–100), `walking_minutes` (0–1440), `distance_m` (0–1000000), `traffic` (`light`, `moderate`, `heavy`, `unknown`), `status` (`open`, `closed`, `unknown`), `is_simulated` (default false). Missing numeric fields are null; missing traffic/status are unknown. Destination is at most 120 characters. Extra fields, inconsistent capacity, duplicate IDs and invalid values are rejected. Availability plus occupied percentage cannot exceed capacity; unknown spaces need not be accounted for as occupied.

The service trusts submitted facts as caller data, **not independently verified detector truth**. Do not submit inferred walking times, prices, schedules or destination facts. Freshness is restricted to 12 seconds (future clock skew ≤2 seconds); stale/closed/zero-or-unknown availability options are excluded. Freshness is checked again after the provider response.

Example using explicitly synthetic facts, with a current timestamp:

```sh
curl --fail-with-body http://127.0.0.1:8400/api/v1/recommendations \
  -H 'Content-Type: application/json' \
  --data "{\"facilities\":[{\"facility_id\":\"demo-garage\",\"name\":\"Synthetic demo garage\",\"total_spaces\":20,\"available_spaces\":4,\"walking_minutes\":5,\"is_simulated\":true,\"observed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]}"
```

Response fields:

- `facility_id`: supplied ID, or null when nothing is eligible.
- `recommendation`: grounded, server-rendered concise explanation.
- `uncertainties`: missing walking time/distance/occupancy/traffic/status/destination caveats.
- `advisory_only`: always true; `expires_at`: timestamp after which the client must discard it.
- `provenance`: `provider=nebius-token-factory`, exact requested `model=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `latency_ms`, `status=success|fallback`, UTC `request_timestamp`, `attempted`, `fallback_reason`, optional `provider_response_id` and `provider_reported_model`.

Fallback provenance names the configured provider/model for debugging; it **does not** claim they generated the result. The UI labels it “Local fallback — not a Nemotron recommendation”. UI advice is discarded on expiry, evidence changes or disconnect. It never changes the existing selectable-space behavior. An in-flight request is aborted on evidence change/unmount.

## Prompt and provider transport

The fixed short system prompt instructs selection from supplied JSON, treats all strings as data, forbids invented facts and requests:

```json
{"facility_id":"provided ID","reasons":["availability"]}
```

Allowed reason codes: `availability`, `walking_time`, `distance`, `occupancy`, `traffic`. A reason requiring an absent field invalidates the answer. The user message is normalized JSON `{destination, facilities}` containing only eligible facilities. Availability is always included in the rendered explanation. There is no free-form application prompt or tool execution.

Transport: POST `https://api.tokenfactory.nebius.com/v1/chat/completions`, bearer authentication, exact user-requested model ID, temperature 0, max_tokens 512, JSON-object response format. Eight-second total deadline including response streaming; 64 KiB response limit; no retries, redirects, proxy environment inheritance or raw-body logging. Response must finish normally and report the expected model (case-insensitive comparison); malformed/truncated/refused/wrong-model outputs fall back.

Official references checked 2026-10-19: [Nebius API](https://api.tokenfactory.nebius.com/docs), [Nebius Nemotron cookbook](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-nano-30b.md). The cookbook currently spells the model ID in lowercase and demonstrates a regional endpoint; this implementation preserves the exact model ID requested by the user and the general Token Factory endpoint. Account-specific availability, accepted casing, structured-output support and latency still require the gated live test. A model-not-found error is reported as fallback, never silently substituted with another model.

## Fallback and cost boundaries

Missing key, timeout/network/provider errors, invalid/ungrounded output, local rate limit or expired evidence trigger deterministic local behavior: select the fresh non-closed facility with most supplied available spaces, then shortest supplied walk/distance, then ID. Missing distances rank last. If no option is eligible, report no fresh confirmed availability. No policy infers OPEN from missing detections.

Per-process guard: at most ten provider attempts per rolling minute and two concurrent calls. This bounds casual demo traffic, **not** total account spend or multi-worker abuse. This local-development endpoint is unauthenticated like existing facility reads. Before public deployment, require authenticated access, gateway quotas and an explicit spending budget. No infrastructure was deployed.

## Verification

```sh
.venv/bin/python -m pytest -q -ra services/api/tests/test_recommendations.py
.venv/bin/python -m pytest -q -ra services/api/tests services/perception/tests packages/contracts/tests evaluation/tests tests
npm run typecheck
npm run build -w @parkright/web
npm run lint
# Optional: makes a real, potentially billed request only when both env flags exist.
PARKRIGHT_NEMOTRON_LIVE=1 .venv/bin/python -m pytest -q -s services/api/tests/test_recommendations.py -k live_nemotron
```

The live test additionally requires an exported `NEBIUS_API_KEY` and asserts **success**, not merely HTTP 200/fallback. It prints measured end-to-end service latency without credentials. No key was present during implementation, so live service success and real Nemotron latency remain unverified. Mock latency is not provider performance evidence.

Local verification: 184 tests passed, two skipped (opt-in Nemotron live call and existing A0 real-weight smoke test). Workspace typechecks, web production build, repository Ruff lint and git whitespace checks passed. Initial sandbox restrictions on localhost test sockets and lint dependency downloads were resolved by approved reruns. The installed Node 25 runtime produced an existing Vitest engine-range warning during installation; the checks above completed successfully. No browser end-to-end suite was run.

The short token/deadline budget is deliberately bounded. If the hosted model spends that budget on reasoning instead of returning its JSON choice, the request falls back; no hidden retry or model substitution occurs. Provider-specific reasoning controls are not assumed without a live compatibility check.

Shared-contract change required: **none**. The frontend uses an endpoint-local response type. Main app changes are limited to client/router registration and the endpoint body-size limit; all perception and simulator paths remain untouched.
