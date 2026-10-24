"""Entry point for the hackathon demo: the unchanged production app plus the demo routes.

    PARKRIGHT_DEMO_MODE=1 python -m parkright_api.demo

``create_app`` (main.py) is not modified; demo mode only adds state and routes on top of it.
"""

import logging

from fastapi import FastAPI

from ..config import Settings
from ..main import API_PREFIX, create_app
from .runtime import DemoRuntime

log = logging.getLogger("parkright.demo")


def create_demo_app(settings: Settings | None = None, perception=None) -> FastAPI:
    settings = settings or Settings()
    if not settings.demo_mode:
        raise ValueError("create_demo_app requires PARKRIGHT_DEMO_MODE=1")
    if settings.showcase_dir is not None and settings.calibration_file is not None:
        raise ValueError("use either PARKRIGHT_SHOWCASE_DIR (several cameras) or PARKRIGHT_CALIBRATION_FILE (one)")
    app = create_app(settings, perception)
    if settings.showcase_dir is not None:
        # Showcase garage: one calibration per CCTV camera; each bay owned by exactly one camera.
        from ..calibration import CalibrationSet

        calibrations = CalibrationSet(sorted(settings.showcase_dir.glob("cam-*.json")))
        for facility in app.state.registry.all():
            calibrations.check_facility(facility.config)
        app.state.calibration = calibrations
    from ..routes import demo

    app.state.demo = DemoRuntime(nemotron_mode=settings.demo_nemotron)
    app.include_router(demo.router, prefix=API_PREFIX)
    log.warning(
        "Hackathon demo mode is ON: fixed scenario, SIMULATED demo availability feed, Nemotron mode %s",
        settings.demo_nemotron,
    )
    return app


def run() -> None:
    import uvicorn

    settings = Settings()
    uvicorn.run(create_demo_app(settings), host=settings.host, port=settings.port, log_level="warning")
