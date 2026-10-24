"""Operational diagnostics; never reads simulator labels or the evaluation store."""

import resource
import sys
from fastapi import APIRouter, Depends, Request
from ..calibration import CalibrationBinding
from ..deps import require_ingest_token
from ..errors import ApiError

router = APIRouter(tags=["Perception diagnostics"])


def snapshot(request: Request):
    p = request.app.state.perception
    status = getattr(
        p, "diagnostics", lambda: {"phase": "unavailable", "inference_ready": False}
    )()
    return {
        "api_alive": True,
        "process_peak_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        / (1024**2 if sys.platform == "darwin" else 1024),
        "model": p.model.model_dump(),
        **status,
        "calibration": request.app.state.calibration.data
        if request.app.state.calibration
        else None,
    }


@router.get("/perception/status", dependencies=[Depends(require_ingest_token)])
def status(request: Request):
    return snapshot(request)


@router.post(
    "/cameras/{camera_id}/calibration", dependencies=[Depends(require_ingest_token)]
)
def bind(camera_id: str, body: CalibrationBinding, request: Request):
    calibration = request.app.state.calibration.for_camera(camera_id) if request.app.state.calibration else None
    if calibration is None:
        raise ApiError(
            409, "calibration_unavailable", "This camera has no active calibration"
        )
    try:
        calibration.bind(body)
    except ValueError as exc:
        raise ApiError(409, "calibration_mismatch", str(exc)) from exc
    return {"bound": True, "version": calibration.data["version"]}
