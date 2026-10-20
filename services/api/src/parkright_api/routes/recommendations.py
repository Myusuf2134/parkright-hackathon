from fastapi import APIRouter, Request

from ..recommendations.models import RecommendationRequest, RecommendationResponse
from ..recommendations.service import recommend

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


@router.post("", response_model=RecommendationResponse)
async def recommendation(data: RecommendationRequest, request: Request) -> RecommendationResponse:
    return await recommend(data, request.app.state.nemotron)
