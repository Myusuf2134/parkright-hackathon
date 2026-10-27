"""DEV/TEST ONLY — never used in production.

Runs the real ParkRight API (real ingestion, ordering, safety normalisation, staleness, WebSocket,
recommendations) with a *scripted* perception provider, and acts as its own camera by posting real
JPEG frames through the authenticated frames endpoint. This lets the driver app be built and tested
against live backend behaviour without A2, PyTorch or a GPU. Nothing here changes the API itself.

    uv run python apps/web/e2e/live_api.py --site mvp --demo --port 8431

POST /__test/states  {"A4": "OCCUPIED", "A5": "UNCERTAIN"}   change what the "camera" sees
POST /__test/camera  {"paused": true}                         stop frames (spaces go stale)
"""

import argparse
import asyncio
import contextlib
import io
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import uvicorn
from fastapi import Body
from PIL import Image
from pydantic import SecretStr

from parkright_api.config import Settings
from parkright_api.main import create_app
from parkright_contracts import ModelRef, OccupancyState
from parkright_perception.provider import CameraView, Frame, SpaceInference

ROOT = Path(__file__).resolve().parents[3]
SITES = {
    "mvp": ROOT / "packages/shared/fixtures/mvp-facility.json",
    "showcase": ROOT / "packages/shared/calibration/garage-showcase/facility.json",
    "ohio": ROOT / "packages/shared/calibration/ohio-union/facility.json",
}
TOKEN = "driver-app-local-test-token"
# The approved v4 screenshot state for the 12-space garage.
MVP_STATES = {"A1": "OCCUPIED", "A2": "OPEN", "A3": "OCCUPIED", "A4": "OPEN", "A5": "UNCERTAIN", "A6": "OPEN",
              "B1": "OPEN", "B2": "OCCUPIED", "B3": "UNCERTAIN", "B4": "OPEN", "B5": "OPEN", "B6": "OPEN"}


class ScriptedProvider:
    """Reports whatever /__test/states says. Confidences are fixed and honest about being scripted."""

    def __init__(self, states: dict[str, str]):
        self.states = states

    @property
    def model(self) -> ModelRef:
        return ModelRef(provider="scripted-test", version="1")

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]:
        out = []
        for s in view.spaces:
            st = OccupancyState(self.states.get(s.space_id, "UNCERTAIN"))
            out.append(SpaceInference(space_id=s.space_id, state=st, confidence=None if st is OccupancyState.UNCERTAIN else 0.93))
        return out


def default_states(fixture: Path) -> dict[str, str]:
    spaces = [s["space_id"] for s in json.loads(fixture.read_text())["spaces"]]
    if set(spaces) == set(MVP_STATES):
        return dict(MVP_STATES)
    pattern = ["OPEN", "OCCUPIED", "OPEN", "OCCUPIED", "OCCUPIED", "UNCERTAIN", "OPEN", "OCCUPIED"]
    return {sid: pattern[i % len(pattern)] for i, sid in enumerate(spaces)}


def jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 36), (120, 124, 128)).save(buf, "JPEG", quality=60)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", choices=SITES, default="mvp")
    ap.add_argument("--demo", action="store_true", help="demo mode: scenario routes, Nemotron local fallback")
    ap.add_argument("--port", type=int, default=8431)
    ap.add_argument("--interval", type=float, default=1.0)
    args = ap.parse_args()

    fixture = SITES[args.site]
    provider = ScriptedProvider(default_states(fixture))
    settings = Settings(
        port=args.port, facility_fixtures=[fixture], ingest_token=SecretStr(TOKEN), evaluation_enabled=False,
        demo_mode=args.demo, demo_nemotron="fallback",
    )
    if args.demo:
        from parkright_api.demo.app import create_demo_app
        app = create_demo_app(settings, provider)
    else:
        app = create_app(settings, provider)

    camera = {"paused": False}
    cameras = [(c["camera_id"]) for c in json.loads(fixture.read_text())["cameras"]]

    @app.post("/__test/states")
    async def set_states(states: dict[str, str] = Body(...)):  # noqa: B008
        provider.states.update(states)
        return provider.states

    @app.post("/__test/camera")
    async def set_camera(body: dict[str, bool] = Body(...)):  # noqa: B008
        camera.update(body)
        return camera

    async def run_camera():
        image = jpeg()
        session = f"driver-test-{datetime.now(UTC):%H%M%S}"
        seq = 0
        await asyncio.sleep(1.0)
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{args.port}", headers={"authorization": f"Bearer {TOKEN}"}) as client:
            while True:
                if not camera["paused"]:
                    for cam in cameras:
                        seq += 1
                        meta = {"session_id": session, "camera_id": cam, "seq": seq, "sim_time_ms": seq * 1000,
                                "captured_at": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
                        with contextlib.suppress(httpx.HTTPError):
                            await client.post(f"/api/v1/cameras/{cam}/frames", data={"metadata": json.dumps(meta)},
                                              files={"image": ("frame.jpg", image, "image/jpeg")})
                await asyncio.sleep(args.interval)

    async def serve():
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning"))
        await asyncio.gather(server.serve(), run_camera())

    asyncio.run(serve())


if __name__ == "__main__":
    main()
