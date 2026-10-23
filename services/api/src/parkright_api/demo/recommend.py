"""Demo recommendation: grounded facts in, driver-facing card out.

Facts: the three demo garages from the fixture, availability from the SIMULATED demo
feed, and freshness from the live camera. The whole snapshot is only as fresh as the
oldest live evidence from the simulator camera, so without a running perception
pipeline there is no recommendation (409). The facts then go through the unchanged
production recommender (recommendations.service.recommend): Nemotron's choice is
validated against these facts, and the deterministic fallback applies when Nemotron
is off, unconfigured or fails. The wording below is rendered by the backend from the
validated choice and the fixture, never from model text.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from parkright_contracts import OccupancyState

from ..recommendations.models import ParkingOption, RecommendationRequest, RecommendationResponse
from ..state import FacilityState
from .availability import DemoAvailabilityFeed
from .fixtures import DemoScenario

NemotronMode = Literal["live", "fallback"]


class CameraSummary(BaseModel):
    facility_id: str
    observed_at: datetime | None
    live_bays: int
    occupied: list[str]
    uncertain: list[str]
    open: list[str]


class GarageComparison(BaseModel):
    facility_id: str
    name: str
    walking_minutes: int
    available_spaces: int
    traffic: str
    chosen: bool


class DemoPresentation(BaseModel):
    recommended: bool
    facility_id: str | None
    garage: str | None
    level: str | None
    space_id: str | None
    walking_minutes: int | None
    destination: str
    class_time: str
    headline: str
    explanation: str
    source: Literal["nemotron", "fallback"]
    source_label: str
    availability_source: Literal["demo-fixture"] = "demo-fixture"
    availability_simulated: Literal[True] = True
    comparison: list[GarageComparison]


def camera_summary(facility: FacilityState, now: datetime) -> CameraSummary:
    spaces = facility.spaces(now)
    live = [s for s in spaces if s.last_observed_at is not None and not s.stale]
    by = lambda state: sorted(s.space_id for s in spaces if s.current_state is state)  # noqa: E731
    return CameraSummary(
        facility_id=facility.facility_id,
        observed_at=min(s.last_observed_at for s in live) if live else None,
        live_bays=len(live),
        occupied=by(OccupancyState.OCCUPIED),
        uncertain=by(OccupancyState.UNCERTAIN),
        open=by(OccupancyState.OPEN),
    )


def build_facts(scenario: DemoScenario, feed: DemoAvailabilityFeed, camera: CameraSummary) -> RecommendationRequest | None:
    """None when the camera has no fresh evidence: no live pipeline, no recommendation."""
    if camera.observed_at is None:
        return None
    options = []
    for candidate in scenario.candidates:
        availability = feed.for_candidate(candidate)
        options.append(ParkingOption(
            facility_id=candidate.facility_id,
            name=candidate.name,
            total_spaces=availability.total_spaces,
            available_spaces=availability.available_spaces,
            occupancy_percentage=round((availability.total_spaces - availability.available_spaces) / availability.total_spaces * 100, 2),
            walking_minutes=float(candidate.walking_minutes),
            distance_m=float(candidate.distance_m),
            traffic=candidate.traffic,
            status=candidate.status,
            is_simulated=True,
            observed_at=camera.observed_at,
        ))
    return RecommendationRequest(facilities=options, destination=scenario.next_class.destination)


def source_label(result: RecommendationResponse, mode: NemotronMode) -> tuple[Literal["nemotron", "fallback"], str]:
    p = result.provenance
    if p.status == "success":
        return "nemotron", "Chosen by NVIDIA Nemotron via Nebius Token Factory, checked by ParkRight against the demo facts."
    if mode == "fallback":
        return "fallback", "Local fallback: the demo is in fallback mode, so NVIDIA Nemotron was not called."
    if p.fallback_reason == "missing_api_key":
        return "fallback", "Local fallback: live mode was requested but NEBIUS_API_KEY is not set."
    return "fallback", f"Local fallback: NVIDIA Nemotron was unavailable ({p.fallback_reason})."


def present(scenario: DemoScenario, facts: RecommendationRequest, result: RecommendationResponse, mode: NemotronMode) -> DemoPresentation:
    source, label = source_label(result, mode)
    chosen_id = result.facility_id
    comparison = [
        GarageComparison(
            facility_id=f.facility_id, name=f.name, walking_minutes=int(f.walking_minutes or 0),
            available_spaces=f.available_spaces or 0, traffic=f.traffic, chosen=f.facility_id == chosen_id,
        )
        for f in facts.facilities
    ]
    cls = scenario.next_class
    if chosen_id is None:
        return DemoPresentation(
            recommended=False, facility_id=None, garage=None, level=None, space_id=None, walking_minutes=None,
            destination=cls.destination, class_time=cls.time,
            headline="No confirmed parking right now",
            explanation="None of the demo garages has fresh, confirmed availability. Uncertain spaces are never offered.",
            source=source, source_label=label, comparison=comparison,
        )
    candidate = scenario.candidate(chosen_id)
    shortest = candidate.walking_minutes == min(c.walking_minutes for c in scenario.candidates)
    if shortest:
        explanation = (
            f"{candidate.name} is your best option for {cls.destination_short} because it gives you the shortest walk "
            "while meeting the demo's confirmed parking-availability criteria."
        )
    else:
        explanation = (
            f"{candidate.name} meets the demo's confirmed parking-availability criteria for {cls.destination_short}, "
            f"with a {candidate.walking_minutes}-minute walk."
        )
    return DemoPresentation(
        recommended=True, facility_id=chosen_id, garage=candidate.name,
        level=candidate.demo_space.level, space_id=candidate.demo_space.space_id,
        walking_minutes=candidate.walking_minutes, destination=cls.destination, class_time=cls.time,
        headline=f"Park at {candidate.name}",
        explanation=explanation, source=source, source_label=label, comparison=comparison,
    )
