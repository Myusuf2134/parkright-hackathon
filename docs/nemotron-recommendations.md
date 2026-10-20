# Nemotron parking recommendations

Isolated feature branch `feat/nemotron-recommendation`, based on integration commit `255026a`. No occupancy, calibration, thresholds, OPEN policy or shared contracts changed.

## Separation of responsibilities

Perception turns camera pixels into occupancy. This service turns caller-supplied structured parking facts into advisory recommendations. It never writes occupancy or offers an individual space. The driver panel supplies only fresh, confirmed OPEN standard spaces as availability; UNCERTAIN is never counted. Simulated facilities are explicitly labelled.

Nemotron returns a minimal structured decision: a supplied facility ID, `RECOMMEND`, fixed reason codes and fixed uncertainty codes. Python independently validates the selection and every code, then renders a concise explanation using only supplied values. Unrestricted model prose and provider reasoning are **never** shown to the driver. Successful provenance means a validated Nemotron selection, not Nemotron-authored free prose. Missing values are reported as unknown, not imputed.

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

## Structured decision and provider transport

The provider is asked for exactly four fields and no explanatory prose:

```json
{
  "selected_facility_id": "garage-01",
  "recommendation_code": "RECOMMEND",
  "reason_codes": ["CONFIRMED_AVAILABILITY"],
  "uncertainty_codes": ["WALKING_TIME_UNKNOWN", "TRAFFIC_UNKNOWN"]
}
```

The request uses Nebius guided JSON plus JSON-object mode. The schema forbids extra fields, fixes all code enums, and dynamically constrains `selected_facility_id` to the IDs actually sent. The same exact schema and a concrete JSON example are included in the system prompt because the hosted endpoint accepted `guided_json` but did not enforce it reliably during the first live probe. The strict prompt is therefore required compatibility behavior; guided JSON remains defense-in-depth.

Each eligible facility also receives backend-derived `allowed_reason_codes` and `required_uncertainty_codes`. The backend recomputes both rather than trusting those copies. It rejects unknown or duplicate codes, omitted or added uncertainty codes, a missing `CONFIRMED_AVAILABILITY`, reasons unsupported by the selected facility, any unrecognized facility ID, and every extra field. Provider-generated counts, walking times, distances, traffic values, prices and destination facts cannot enter rendering because the decision schema has no fields for them.

Allowed reason codes are `CONFIRMED_AVAILABILITY`, `SHORTER_WALK`, `SHORTER_DISTANCE`, `LOWER_OCCUPANCY` and `LIGHTER_TRAFFIC`. Allowed uncertainty codes cover missing walking time, distance, occupancy, traffic, operating status and destination. Availability is always included in the backend-rendered explanation. There is no free-form application prompt or tool execution.

Transport: POST `https://api.tokenfactory.nebius.com/v1/chat/completions`, bearer authentication, exact user-requested model ID, temperature 0, max_tokens 1024, JSON-object response format, guided JSON, and `chat_template_kwargs.enable_thinking=false`. Eight-second total deadline including response streaming; 64 KiB response limit; no retries, redirects, proxy environment inheritance or raw-body logging. Response must finish normally and report the expected model (case-insensitive comparison); malformed/truncated/refused/wrong-model outputs fall back. Even if a provider response contains separate reasoning fields, the client reads only the final structured `message.content`; reasoning is neither logged nor returned by the API.

Official references checked 2026-10-19: [Nebius Nemotron model guide](https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/nemotron3-nano-30b.md), [Nebius guided JSON example](https://github.com/nebius/token-factory-cookbook/blob/main/guided_json.ipynb), and [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8). The Nebius guide identifies this model as supporting structured output; the guided JSON example combines `guided_json` with JSON-object mode; NVIDIA documents disabling thinking with `chat_template_kwargs`. The cookbook spells the model ID in lowercase and demonstrates a regional endpoint, while this implementation preserves the exact required model ID and the general Token Factory endpoint. A model-not-found error is reported as fallback, never silently substituted with another model.

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

The live test additionally requires an exported `NEBIUS_API_KEY` and asserts **success**, not merely HTTP 200/fallback. It covers one confirmed facility, multiple supplied facilities, missing walking time, missing traffic, stale/unknown availability, and irrelevant prompt-injection text. Output is limited to the schema-sanitized structured decision, backend-rendered response and provenance; credentials, raw provider bodies and reasoning are never printed.

Live verification on 2026-10-19 succeeded through `POST /api/v1/recommendations` for all six cases with exact provider-reported model `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Five provider calls completed in 1475.00–1767.13 ms. Missing walking time and traffic produced exactly their corresponding uncertainty codes and backend wording. Stale/unknown availability did not call the provider and returned deterministic `no_confirmed_availability` fallback. Irrelevant text asking for invented free parking and a schedule did not appear in the structured decision or rendered recommendation.

Local verification: 196 tests passed and two explicitly gated tests skipped (the paid Nemotron live matrix without its opt-in flag, and the existing A0 real-weight smoke test). The focused recommendation file has 57 passing non-live tests. Workspace typechecks, the web production build, repository Ruff lint and git whitespace checks passed. The six-case live matrix also passed separately with the opt-in flag. The live run prints actual per-case latency; mock latency is not provider performance evidence.

The token/deadline budget is deliberately bounded. If the hosted model fails to return its schema-valid choice within that budget, the request falls back; no hidden retry or model substitution occurs.

Shared-contract change required: **none**. The frontend uses an endpoint-local response type. Main app changes are limited to client/router registration and the endpoint body-size limit; all perception and simulator paths remain untouched.
