from datetime import UTC, datetime, timedelta
import time

from .client import NemotronClient, ProviderFailure
from .models import (
    ModelChoice,
    ParkingOption,
    Provenance,
    RecommendationRequest,
    RecommendationResponse,
    UncertaintyCode,
)

MAX_AGE_SECONDS = 12


def eligible(option: ParkingOption, now: datetime) -> bool:
    age = (now - option.observed_at).total_seconds()
    return (
        -2 <= age < MAX_AGE_SECONDS and option.status != "closed"
        and option.available_spaces is not None and option.available_spaces > 0
    )


def supported(option: ParkingOption) -> dict[str, str]:
    facts = {
        "CONFIRMED_AVAILABILITY": f"{option.available_spaces} of {option.total_spaces} spaces reported available",
    }
    for key, value, unit in (
        ("SHORTER_WALK", option.walking_minutes, "minutes walking"),
        ("SHORTER_DISTANCE", option.distance_m, "metres away"),
        ("LOWER_OCCUPANCY", option.occupancy_percentage, "% occupied"),
    ):
        if value is not None:
            facts[key] = f"{value:g} {unit}"
    if option.traffic != "unknown":
        facts["LIGHTER_TRAFFIC"] = f"reported {option.traffic} traffic"
    return facts


def uncertainty_codes(option: ParkingOption, data: RecommendationRequest) -> list[UncertaintyCode]:
    return [
        code for missing, code in (
            (option.walking_minutes is None, "WALKING_TIME_UNKNOWN"),
            (option.distance_m is None, "DISTANCE_UNKNOWN"),
            (option.occupancy_percentage is None, "OCCUPANCY_UNKNOWN"),
            (option.traffic == "unknown", "TRAFFIC_UNKNOWN"),
            (option.status == "unknown", "OPERATING_STATUS_UNKNOWN"),
            (data.destination is None, "DESTINATION_UNSPECIFIED"),
        ) if missing
    ]


UNCERTAINTY_TEXT: dict[UncertaintyCode, str] = {
    "WALKING_TIME_UNKNOWN": "Walking time is unknown.",
    "DISTANCE_UNKNOWN": "Distance is unknown.",
    "OCCUPANCY_UNKNOWN": "Occupancy percentage is unknown.",
    "TRAFFIC_UNKNOWN": "Traffic is unknown.",
    "OPERATING_STATUS_UNKNOWN": "Facility operating status is unknown.",
    "DESTINATION_UNSPECIFIED": "Destination is unspecified.",
}


def validate_choice(
    choice: ModelChoice, options: list[ParkingOption], data: RecommendationRequest,
) -> tuple[ParkingOption, list[str], list[UncertaintyCode]]:
    chosen = next((option for option in options if option.facility_id == choice.selected_facility_id), None)
    if chosen is None:
        raise ProviderFailure("ungrounded_provider_response")
    supported_facts = supported(chosen)
    if (
        choice.recommendation_code != "RECOMMEND"
        or "CONFIRMED_AVAILABILITY" not in choice.reason_codes
        or any(code not in supported_facts for code in choice.reason_codes)
    ):
        raise ProviderFailure("ungrounded_provider_response")
    expected_uncertainties = uncertainty_codes(chosen, data)
    if set(choice.uncertainty_codes) != set(expected_uncertainties):
        raise ProviderFailure("ungrounded_provider_response")
    return chosen, choice.reason_codes, expected_uncertainties


async def recommend(data: RecommendationRequest, client: NemotronClient) -> RecommendationResponse:
    started = time.perf_counter()
    requested = datetime.now(UTC)
    options = [f for f in data.facilities if eligible(f, requested)]
    reason = "no_confirmed_availability"
    attempted, chosen, reasons, uncertainties_codes, response_id, reported_model = False, None, [], [], None, None
    if options:
        reason = None
        try:
            if not client.configured:
                raise ProviderFailure("missing_api_key")
            attempted = True
            choice, response_id, reported_model = await client.choose({
                "destination": data.destination,
                "facilities": [{
                    **f.model_dump(mode="json"),
                    "allowed_reason_codes": list(supported(f)),
                    "required_uncertainty_codes": uncertainty_codes(f, data),
                } for f in options],
            })
            chosen, reasons, uncertainties_codes = validate_choice(choice, options, data)
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
            reasons = ["CONFIRMED_AVAILABILITY"]
            uncertainties_codes = uncertainty_codes(chosen, data)
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
        uncertainties = [UNCERTAINTY_TEXT[code] for code in uncertainties_codes]
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
