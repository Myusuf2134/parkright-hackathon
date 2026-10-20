import asyncio
import contextlib
import logging
from collections import defaultdict
from collections.abc import AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from parkright_contracts import OccupancyUpdateMessage, count_states
from parkright_perception import PerceptionProvider, create_provider

from .calibration import Calibration
from .config import Settings
from .deps import now
from .errors import install_error_handlers
from .realtime import RealtimeHub
from .recommendations.client import NemotronClient
from .routes import recommendations
from .routes import facilities, frames, health, realtime, perception as perception_routes
from .state import FacilityRegistry
from .stream_tracker import FrameStreamTracker
from .upload_limit import UploadLimitMiddleware

API_PREFIX = "/api/v1"
log = logging.getLogger("parkright.api")


async def _staleness_sweeper(app: FastAPI, interval_s: float = 1.0) -> None:
    """Tells subscribers when evidence goes stale. Reads are correct without it."""
    while True:
        await asyncio.sleep(interval_s)
        t = now()
        for facility in app.state.registry.all():
            newly_stale, changes = facility.sweep(t)
            if newly_stale:
                spaces = facility.spaces(t)
                message = OccupancyUpdateMessage(
                    facility_id=facility.facility_id, changes=changes, counts=count_states([s.current_state for s in spaces]),
                    spaces=spaces, frame=None, published_at=t,
                )
                app.state.hub.publish(facility.facility_id, message.model_dump_json())


def create_app(settings: Settings | None = None, perception: PerceptionProvider | None = None) -> FastAPI:
    settings = settings or Settings()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.ingest_token is None:
            log.warning("PARKRIGHT_INGEST_TOKEN is not set: frame ingestion is unauthenticated (development only)")
        warmup = getattr(app.state.perception, "warmup", None)
        warm_task = asyncio.create_task(warmup()) if warmup else None
        task = asyncio.create_task(_staleness_sweeper(app))
        yield
        if warm_task:
            await warm_task
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(
        title="ParkRight API",
        version="0.1.0",
        description="Camera frames in, parking availability out. Frame contract: docs/frame-contract.md.",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.state.settings = settings
    app.state.nemotron = NemotronClient()
    app.state.registry = FacilityRegistry.from_fixtures(settings.facility_fixtures, settings.stale_after_ms)
    app.state.perception = perception or create_provider(settings.perception_provider)
    app.state.calibration = Calibration(settings.calibration_file) if settings.calibration_file else None
    if app.state.calibration:
        for facility in app.state.registry.all():
            for camera in facility.config.cameras:
                if camera.camera_id == app.state.calibration.data["camera_id"] and not app.state.calibration.matches_view(camera):
                    raise ValueError("facility polygons differ from calibration")
    app.state.tracker = FrameStreamTracker(settings.frame_max_age_ms)
    app.state.camera_locks = defaultdict(asyncio.Lock)
    app.state.hub = RealtimeHub()

    install_error_handlers(app)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["authorization", "content-type"])
    # Whole-request cap for frame uploads: the JPEG limit plus room for metadata and multipart framing.
    app.add_middleware(UploadLimitMiddleware, path_pattern=rf"{API_PREFIX}/cameras/[^/]+/frames", max_bytes=settings.frame_max_bytes + 64 * 1024)
    app.add_middleware(UploadLimitMiddleware, path_pattern=rf"{API_PREFIX}/recommendations", max_bytes=16384)

    api = APIRouter(prefix=API_PREFIX)
    api.include_router(health.router)
    api.include_router(recommendations.router)
    api.include_router(recommendations.facility_router)
    api.include_router(perception_routes.router)
    api.include_router(facilities.router)
    api.include_router(frames.router)
    api.include_router(realtime.router)
    if settings.evaluation_on:
        # Imported here so that, with evaluation off, the evaluation package is never even loaded.
        from parkright_evaluation import GroundTruthStore

        from .routes import evaluation

        app.state.ground_truth = GroundTruthStore()
        api.include_router(evaluation.router)
    app.include_router(api)
    return app


def run() -> None:
    import uvicorn

    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
