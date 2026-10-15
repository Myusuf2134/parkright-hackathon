import hmac
from datetime import UTC, datetime

from fastapi import Request

from .config import Settings
from .errors import ApiError
from .realtime import RealtimeHub
from .state import FacilityRegistry, FacilityState


def now() -> datetime:
    return datetime.now(UTC)


def settings(request: Request) -> Settings:
    return request.app.state.settings


def registry(request: Request) -> FacilityRegistry:
    return request.app.state.registry


def hub(request: Request) -> RealtimeHub:
    return request.app.state.hub


def facility_or_404(request: Request, facility_id: str) -> FacilityState:
    facility = registry(request).get(facility_id)
    if facility is None:
        raise ApiError(404, "not_found", f'Facility "{facility_id}" not found')
    return facility


def require_ingest_token(request: Request) -> None:
    """Cameras and the evaluation feed authenticate with one shared bearer token.
    Unset outside production means open (local development); production refuses to start without it."""
    expected = settings(request).ingest_token
    if expected is None:
        return
    header = request.headers.get("authorization", "")
    presented = header[7:].strip() if header.startswith("Bearer ") else ""
    if not hmac.compare_digest(presented.encode(), expected.get_secret_value().encode()):
        raise ApiError(401, "unauthorized", "A valid ingest token is required (Authorization: Bearer …)")
