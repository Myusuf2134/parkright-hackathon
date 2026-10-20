"""Recommendation facts assembled from ParkRight's own occupancy state, never from the client.

Only driver-visible state is used (the same reads as GET /facilities/{id}/spaces), so
simulator ground truth cannot enter: it lives behind the evaluation route and never
reaches FacilityState. Facts ParkRight does not measure stay unknown and surface as
uncertainties; nothing is imputed.
"""

from datetime import datetime

from parkright_contracts import OccupancyState

from ..state import FacilityState
from .models import ParkingOption, RecommendationRequest


def request_from_state(facility: FacilityState, now: datetime) -> RecommendationRequest | None:
    """None when no space has fresh evidence (nothing to recommend from)."""
    spaces = facility.spaces(now)
    live = [s for s in spaces if s.last_observed_at is not None and not s.stale]
    if not live:
        return None
    # Availability is confirmed OPEN only; UNCERTAIN is never counted as available.
    available = sum(s.current_state is OccupancyState.OPEN and s.designation == "standard" for s in live)
    occupied = sum(s.current_state is OccupancyState.OCCUPIED for s in live)
    # A percentage is only a fact when every space is resolved; otherwise it is unknown.
    resolved = all(s.current_state is not OccupancyState.UNCERTAIN for s in spaces) and len(live) == len(spaces)
    return RecommendationRequest(facilities=[ParkingOption(
        facility_id=facility.facility_id,
        name=facility.config.name,
        total_spaces=len(spaces),
        available_spaces=available,
        occupancy_percentage=round(occupied / len(spaces) * 100, 2) if resolved else None,
        is_simulated=facility.config.is_simulated,
        # The facts are only as fresh as the oldest evidence they rest on.
        observed_at=min(s.last_observed_at for s in live),
    )])
