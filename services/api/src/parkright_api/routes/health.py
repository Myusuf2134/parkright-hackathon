from fastapi import APIRouter, Request
from pydantic import BaseModel

from parkright_contracts import FRAME_CONTRACT_VERSION, ModelRef

from ..deps import hub, registry, settings

router = APIRouter(tags=["Health"])


class Health(BaseModel):
    status: str
    frame_contract_version: int
    perception: ModelRef
    facilities: int
    realtime_subscribers: int
    evaluation_enabled: bool
    inference: dict
    calibration: dict | None


@router.get("/health", response_model=Health)
def health(request: Request) -> Health:
    return Health(
        status="ok",
        inference=getattr(request.app.state.perception, "diagnostics", lambda: {"phase":"unavailable", "inference_ready":False})(),
        calibration=request.app.state.calibration.data if request.app.state.calibration else None,
        frame_contract_version=FRAME_CONTRACT_VERSION,
        perception=request.app.state.perception.model,
        facilities=len(registry(request).all()),
        realtime_subscribers=hub(request).subscriber_count(),
        evaluation_enabled=settings(request).evaluation_on,
    )
