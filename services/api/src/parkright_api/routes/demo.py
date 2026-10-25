"""Hackathon demo routes. Mounted only when PARKRIGHT_DEMO_MODE is on.

    GET  /api/v1/demo/status                 everything the demo check and the UI need (never a key)
    GET  /api/v1/demo/scenario               the fixed demo fixture
    GET  /api/v1/demo/camera/latest.jpg      the last frame A2 processed (for the driver demo view)
    POST /api/v1/demo/recommendation         grounded recommendation for the demo class
    POST /api/v1/demo/reset                  back to the known starting state
"""

from fastapi import APIRouter, Request, Response

from ..deps import facility_or_404, now
from ..errors import ApiError, ErrorResponse
from ..recommendations.models import MODEL, PROVIDER
from ..recommendations.service import recommend
from ..demo.recommend import build_facts, camera_summary, present
from ..demo.runtime import DemoRuntime

router = APIRouter(prefix="/demo", tags=["Hackathon demo"], responses={409: {"model": ErrorResponse}})


def _demo(request: Request) -> DemoRuntime:
    return request.app.state.demo


def _perception(request: Request) -> dict:
    p = request.app.state.perception
    d = getattr(p, "diagnostics", lambda: {"phase": "unavailable", "inference_ready": False})()
    return {
        "provider": p.model.provider,
        "version": p.model.version,
        "phase": d.get("phase"),
        "inference_ready": bool(d.get("inference_ready")),
        # inference_ready is false while a frame is being processed; loaded is the stable "model is up" signal.
        "loaded": d.get("phase") in ("ready", "degraded") and bool(d.get("warmup_successful")),
        "identity": d.get("identity"),
        "artifact_error": d.get("artifact_error"),
        # The mapper's own setting, read from the running provider, not a constant.
        "allow_open": bool((d.get("thresholds") or {}).get("allow_open", False)),
    }


def _is_showcase(request: Request) -> bool:
    from ..calibration import CalibrationSet

    return isinstance(request.app.state.calibration, CalibrationSet)


def _single_polygons(request: Request) -> dict | None:
    cal = request.app.state.calibration
    return None if cal is None or _is_showcase(request) else cal.data["polygons"]


def _cameras(request: Request, t) -> list[dict]:
    """Every camera of the demo facility: owned bays, its polygons and its latest processed frame."""
    demo = _demo(request)
    facility = facility_or_404(request, demo.scenario.simulator.facility_id)
    out = []
    for c in facility.config.cameras:
        cal = request.app.state.calibration.for_camera(c.camera_id) if request.app.state.calibration else None
        f = demo.latest_by_camera.get(c.camera_id)
        out.append({
            "camera_id": c.camera_id,
            "name": c.name,
            "owned": list(c.watches),
            "polygons": cal.data["polygons"] if cal else None,
            "last_frame": None if f is None else {
                "seq": f.seq, "received_at": f.received_at.isoformat(), "age_s": round((t - f.received_at).total_seconds(), 2),
                "detections": f.detections, "timings": f.timings,
            },
        })
    return out


@router.get("/events")
def events(request: Request, after: int = 0) -> dict:
    """Perception events since `after` (one per processed frame: camera, vehicles, bay changes)."""
    demo = _demo(request)
    return {"epoch": demo.epoch, "events": [e for e in demo.events if e["id"] > after]}


@router.get("/status")
def status(request: Request) -> dict:
    demo = _demo(request)
    t = now()
    scene = demo.scenario.simulator
    cam = camera_summary(facility_or_404(request, scene.facility_id), t)
    latest = demo.latest
    client = request.app.state.nemotron
    return {
        "demo_mode": True,
        "scenario_id": demo.scenario.scenario_id,
        "fixture_sha256": demo.fixture_sha256,
        "epoch": demo.epoch,
        "reset_at": demo.reset_at,
        "frames_since_reset": demo.frames_since_reset,
        "simulator": {"hash": scene.hash, "stream_fps": scene.stream_fps, "camera_id": scene.camera_id},
        "nemotron": {
            "mode": demo.nemotron_mode, "provider": PROVIDER, "model": MODEL,
            "live_configured": client.configured,
            "will_call_nemotron": demo.nemotron_mode == "live" and client.configured,
        },
        "perception": _perception(request),
        "calibration": _single_polygons(request),
        "showcase": _is_showcase(request),
        "site": getattr(request.app.state, "demo_site", None),
        "stale_after_s": request.app.state.settings.stale_after_ms / 1000,
        "cameras": _cameras(request, t),
        "camera": {
            **cam.model_dump(mode="json"),
            "fresh": cam.observed_at is not None,
            "last_frame": None if latest is None else {
                "seq": latest.seq, "session_id": latest.session_id, "received_at": latest.received_at.isoformat(),
                "age_s": round((t - latest.received_at).total_seconds(), 2),
                "detections": latest.detections, "timings": latest.timings,
            },
        },
    }


@router.get("/scenario")
def scenario(request: Request) -> dict:
    demo = _demo(request)
    return {
        **demo.scenario.model_dump(mode="json", by_alias=True),
        "fixture_sha256": demo.fixture_sha256,
        "availability_feed": [
            {"facility_id": a.facility_id, "available_spaces": a.available_spaces, "total_spaces": a.total_spaces,
             "source": a.source, "simulated": a.simulated}
            for a in demo.feed.all()
        ],
    }


@router.get("/camera/latest.jpg", responses={404: {"model": ErrorResponse}})
def latest_frame(request: Request, camera_id: str | None = None) -> Response:
    demo = _demo(request)
    latest = demo.latest_by_camera.get(camera_id) if camera_id else demo.latest
    if latest is None:
        raise ApiError(404, "no_frame", "No frame has been processed since the last reset")
    return Response(latest.jpeg, media_type="image/jpeg", headers={"cache-control": "no-store", "x-frame-seq": str(latest.seq)})


@router.post("/recommendation")
async def demo_recommendation(request: Request) -> dict:
    demo = _demo(request)
    scene = demo.scenario.simulator
    cam = camera_summary(facility_or_404(request, scene.facility_id), now())
    facts = build_facts(demo.scenario, demo.feed, cam)
    if facts is None:
        raise ApiError(409, "no_observation", "The demo camera has no fresh evidence yet: start the simulator stream first")
    result = await recommend(facts, demo.client(request.app.state.nemotron))
    return {
        "facts": facts.model_dump(mode="json"),
        "result": result.model_dump(mode="json"),
        "presentation": present(demo.scenario, facts, result, demo.nemotron_mode).model_dump(mode="json"),
        "camera": cam.model_dump(mode="json"),
    }


@router.post("/reset")
def reset(request: Request) -> dict:
    demo = _demo(request)
    demo.reset(request.app, now())
    return {"reset": True, "epoch": demo.epoch, "scenario_id": demo.scenario.scenario_id}
