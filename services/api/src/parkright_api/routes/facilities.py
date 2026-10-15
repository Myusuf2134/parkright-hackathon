"""Driver-facing read API. Public: availability of a monitored facility is not secret."""

from fastapi import APIRouter, Query, Request

from parkright_contracts import Facility, FacilityOccupancy, Level, LevelId, ParkingSpace, count_states

from ..deps import facility_or_404, now, registry
from ..errors import ApiError, ErrorResponse

router = APIRouter(prefix="/facilities", tags=["Facilities"], responses={404: {"model": ErrorResponse}})


@router.get("", response_model=list[Facility])
def list_facilities(request: Request) -> list[Facility]:
    t = now()
    return [f.facility(t) for f in registry(request).all()]


@router.get("/{facility_id}", response_model=Facility)
def get_facility(request: Request, facility_id: str) -> Facility:
    return facility_or_404(request, facility_id).facility(now())


@router.get("/{facility_id}/levels", response_model=list[Level])
def get_levels(request: Request, facility_id: str) -> list[Level]:
    return facility_or_404(request, facility_id).facility(now()).levels


@router.get(
    "/{facility_id}/spaces",
    response_model=FacilityOccupancy,
    description="Latest occupancy. Only current_state OPEN with stale false is availability; UNCERTAIN never is.",
)
def get_spaces(request: Request, facility_id: str, level_id: LevelId | None = Query(default=None)) -> FacilityOccupancy:
    facility = facility_or_404(request, facility_id)
    t = now()
    spaces = [s for s in facility.spaces(t) if level_id is None or s.level_id == level_id]
    return FacilityOccupancy(facility_id=facility_id, counts=count_states([s.current_state for s in spaces]), spaces=spaces, generated_at=t)


@router.get("/{facility_id}/spaces/{space_id}", response_model=ParkingSpace)
def get_space(request: Request, facility_id: str, space_id: str) -> ParkingSpace:
    facility = facility_or_404(request, facility_id)
    match = next((s for s in facility.spaces(now()) if s.space_id == space_id), None)
    if match is None:
        raise ApiError(404, "not_found", f'Space "{space_id}" not found')
    return match
