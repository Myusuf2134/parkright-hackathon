from datetime import UTC, datetime, timedelta
import time

from .client import NemotronClient, ProviderFailure
from .models import ParkingOption, Provenance, RecommendationRequest, RecommendationResponse

MAX_AGE_SECONDS = 12


def eligible(option: ParkingOption, now: datetime) -> bool:
    age = (now - option.observed_at).total_seconds()
    return (
        -2 <= age < MAX_AGE_SECONDS and option.status != "closed"
        and option.available_spaces is not None and option.available_spaces > 0
    )


def supported(option: ParkingOption) -> dict[str, str]:
    facts = {"availability": f"{option.available_spaces} of {option.total_spaces} spaces reported available"}
    for key, value, unit in (
        ("walking_time", option.walking_minutes, "minutes walking"),
        ("distance", option.distance_m, "metres away"),
        ("occupancy", option.occupancy_percentage, "% occupied"),
    ):
        if value is not None:
            facts[key] = f"{value:g} {unit}"
    if option.traffic != "unknown":
        facts["traffic"] = f"reported {option.traffic} traffic"
    return facts


async def recommend(data: RecommendationRequest, client: NemotronClient) -> RecommendationResponse:
    started = time.perf_counter()
    requested = datetime.now(UTC)
    options = [f for f in data.facilities if eligible(f, requested)]
    reason = "no_confirmed_availability"
    attempted, chosen, reasons, response_id, reported_model = False, None, [], None, None
    if options:
        reason = None
        try:
            if not client.configured:
                raise ProviderFailure("missing_api_key")
            attempted = True
            choice, response_id, reported_model = await client.choose({
                "destination": data.destination,
                "facilities": [f.model_dump(mode="json") for f in options],
            })
            chosen = next((f for f in options if f.facility_id == choice.facility_id), None)
            if chosen is None or any(r not in supported(chosen) for r in choice.reasons):
                raise ProviderFailure("ungrounded_provider_response")
            reasons = list(dict.fromkeys(["availability", *choice.reasons]))
        except ProviderFailure as exc:
            reason = str(exc)
            chosen = None
        # Never return an availability recommendation whose input expired while awaiting the model.
        current = datetime.now(UTC)
        fresh = [f for f in options if eligible(f, current)]
        if chosen is not None and chosen not in fresh:
            reason, chosen = "snapshot_expired", None
        if chosen is None and fresh:
            chosen = sorted(fresh, key=lambda f: (
                -(f.available_spaces or 0),
                f.walking_minutes if f.walking_minutes is not None else float("inf"),
                f.distance_m if f.distance_m is not None else float("inf"), f.facility_id,
            ))[0]
            reasons = ["availability"]
        elif chosen is None:
            reason = "snapshot_expired"
    if chosen is None:
        text = "No fresh, confirmed availability was provided. Do not treat uncertain spaces as available."
        uncertainties = ["Availability may be missing, zero, stale, or the facility may be closed."]
        expires = datetime.now(UTC) + timedelta(seconds=MAX_AGE_SECONDS)
    else:
        facts = supported(chosen)
        text = f"Consider {chosen.name}: " + "; ".join(facts[r] for r in reasons) + "."
        if chosen.is_simulated:
            text = "Simulation only — not a real parking recommendation. " + text
        uncertainties = [
            label for missing, label in (
                (chosen.walking_minutes is None, "Walking time is unknown."),
                (chosen.distance_m is None, "Distance is unknown."),
                (chosen.occupancy_percentage is None, "Occupancy percentage is unknown."),
                (chosen.traffic == "unknown", "Traffic is unknown."),
                (chosen.status == "unknown", "Facility operating status is unknown."),
                (data.destination is None, "Destination is unspecified."),
            ) if missing
        ]
        expires = chosen.observed_at + timedelta(seconds=MAX_AGE_SECONDS)
    return RecommendationResponse(
        facility_id=chosen.facility_id if chosen else None,
        recommendation=text, uncertainties=uncertainties, expires_at=expires,
        provenance=Provenance(
            latency_ms=round((time.perf_counter()-started)*1000, 2),
            status="fallback" if reason else "success", request_timestamp=requested,
            attempted=attempted, fallback_reason=reason,
            provider_response_id=response_id, provider_reported_model=reported_model,
        ),
    )
