from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..deps import facility_or_404, now
from ..errors import ApiError, ErrorResponse
from ..recommendations.facts import request_from_state
from ..recommendations.models import MODEL, PROVIDER, RecommendationRequest, RecommendationResponse
from ..recommendations.service import recommend

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])
facility_router = APIRouter(prefix="/facilities", tags=["Recommendations"], responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}})


class RecommenderStatus(BaseModel):
    provider: str
    model: str
    configured: bool
    advisory_only: bool = True


class FacilityRecommendation(BaseModel):
    facts: RecommendationRequest
    result: RecommendationResponse


@router.post("", response_model=RecommendationResponse)
async def recommendation(data: RecommendationRequest, request: Request) -> RecommendationResponse:
    return await recommend(data, request.app.state.nemotron)


@router.get("/status", response_model=RecommenderStatus, description="Whether a provider key is configured. Never returns the key.")
def recommender_status(request: Request) -> RecommenderStatus:
    return RecommenderStatus(provider=PROVIDER, model=MODEL, configured=request.app.state.nemotron.configured)


@facility_router.post(
    "/{facility_id}/recommendation",
    response_model=FacilityRecommendation,
    description="Recommendation from this facility's current occupancy state; the client supplies no facts.",
)
async def facility_recommendation(request: Request, facility_id: str) -> FacilityRecommendation:
    facts = request_from_state(facility_or_404(request, facility_id), now())
    if facts is None:
        raise ApiError(409, "no_observation", "No fresh occupancy evidence for this facility")
    return FacilityRecommendation(facts=facts, result=await recommend(facts, request.app.state.nemotron))
