"""DEV/DEMO ONLY: the real ParkRight API serving several simulated garages for the student app.

Real ingestion, staleness, WebSocket and recommendations; a scripted provider instead of A2, acting as
its own cameras through the authenticated frames endpoint (same approach as live_api.py). Every facility
is is_simulated and every state is labelled as coming from a scripted source. No API code changes.

    garage-01        the 12-space virtual garage (the fixture's stand-in for Tuttle Garage)
    ohio-union-sim   the Ohio Union North Garage-inspired simulation (72 spaces)
    demo-deck        a two-level simulated deck with accessible, EV and reserved bays, for floor switching

    uv run --frozen python apps/web/e2e/student_api.py --port 8400 --traffic 4

POST /__test/states  {"garage-01": {"A4": "OCCUPIED"}}   change what a garage's "cameras" see
POST /__test/camera  {"paused": true}                    stop frames (spaces go stale)
POST /__test/reset                                       back to the starting states
"""

import argparse
import asyncio
import contextlib
import json
import random
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import httpx
import uvicorn
from fastapi import Body
from live_api import MVP_STATES, SITES, TOKEN, default_states, jpeg
from parkright_api.config import Settings
from parkright_api.demo.app import create_demo_app
from parkright_contracts import ModelRef, OccupancyState
from parkright_perception.provider import CameraView, Frame, SpaceInference
from pydantic import SecretStr


def ohio() -> dict:
    d = json.loads(SITES["ohio"].read_text())
    d["facility_id"] = "ohio-union-sim"
    for c in d["cameras"]:
        c["camera_id"] = f"ohio-{c['camera_id']}"
    return d


def deck() -> dict:
    mvp = json.loads(SITES["mvp"].read_text())
    special = {"A1": "accessible", "A6": "ev", "D6": "reserved"}
    spaces, cameras = [], []
    for level, rows in (("L1", {"A": "A", "B": "B"}), ("L2", {"A": "C", "B": "D"})):
        ids = []
        for s in mvp["spaces"]:
            sid = rows[s["space_id"][0]] + s["space_id"][1:]
            ids.append(sid)
            spaces.append({"space_id": sid, "level_id": level, "plan": s["plan"], "designation": special.get(sid, "standard")})
        cameras.append({"camera_id": f"deck-cam-{level}", "level_id": level, "name": f"Deck camera {level}", "kind": "virtual", "watches": ids})
    return {
        "facility_id": "demo-deck", "name": "Meridian Two-Level Demo Deck", "address": None, "is_simulated": True,
        "levels": [{"level_id": "L1", "name": "Level 1", "ordinal": 0}, {"level_id": "L2", "name": "Level 2", "ordinal": 1}],
        "spaces": spaces, "cameras": cameras,
    }


class FleetProvider:
    """Reports the scripted state of each garage, found through the camera asking."""

    def __init__(self, by_camera: dict[str, str], states: dict[str, dict[str, str]]):
        self.by_camera = by_camera
        self.states = states

    @property
    def model(self) -> ModelRef:
        return ModelRef(provider="scripted-test", version="1")

    def diagnostics(self) -> dict:
        return {"phase": "scripted", "inference_ready": True, "warmup_successful": False, "thresholds": {"allow_open": True}}

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]:
        states = self.states[self.by_camera[view.camera_id]]
        out = []
        for s in view.spaces:
            st = OccupancyState(states.get(s.space_id, "UNCERTAIN"))
            out.append(SpaceInference(space_id=s.space_id, state=st, confidence=None if st is OccupancyState.UNCERTAIN else 0.93))
        return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8400)
    ap.add_argument("--interval", type=float, default=2.0, help="seconds between frames per camera")
    ap.add_argument("--traffic", type=float, default=0, help="change a few bays every N seconds (0 = only via /__test/states)")
    args = ap.parse_args()

    facilities = [json.loads(SITES["mvp"].read_text()), ohio(), deck()]
    tmp = Path(tempfile.mkdtemp(prefix="meridian-student-"))
    paths = []
    for f in facilities:
        path = tmp / f"{f['facility_id']}.json"
        path.write_text(json.dumps(f))
        paths.append(path)

    def starting() -> dict[str, dict[str, str]]:
        out = {"garage-01": dict(MVP_STATES), "ohio-union-sim": default_states(SITES["ohio"])}
        pattern = ["OPEN", "OCCUPIED", "OPEN", "UNCERTAIN", "OPEN", "OCCUPIED"]
        out["demo-deck"] = {s["space_id"]: pattern[i % len(pattern)] for i, s in enumerate(facilities[2]["spaces"])}
        return out

    by_camera = {c["camera_id"]: f["facility_id"] for f in facilities for c in f["cameras"]}
    provider = FleetProvider(by_camera, starting())
    settings = Settings(port=args.port, facility_fixtures=paths, ingest_token=SecretStr(TOKEN), evaluation_enabled=False, demo_mode=True, demo_nemotron="fallback")
    app = create_demo_app(settings, provider)
    # Describes the Ohio facility only; the app matches it to that garage by title.
    app.state.demo_site = json.loads((SITES["ohio"].parent / "site.json").read_text())
    camera = {"paused": False}

    @app.post("/__test/states")
    async def set_states(body: dict[str, dict[str, str]] = Body(...)):  # noqa: B008
        for facility_id, states in body.items():
            provider.states[facility_id].update(states)
        return {"ok": True}

    @app.post("/__test/camera")
    async def set_camera(body: dict[str, bool] = Body(...)):  # noqa: B008
        camera.update(body)
        return camera

    @app.post("/__test/reset")
    async def reset():
        provider.states.clear()
        provider.states.update(starting())
        camera["paused"] = False
        return {"ok": True}

    async def run_traffic():
        rng = random.Random(7)
        while args.traffic:
            await asyncio.sleep(args.traffic)
            for states in provider.states.values():
                for sid in rng.sample(sorted(states), k=rng.randint(1, 3)):
                    # Always a visible change: a car arrives or leaves; now and then a view turns unclear.
                    was = states[sid]
                    states[sid] = "UNCERTAIN" if rng.random() < 0.1 else "OCCUPIED" if was == "OPEN" else "OPEN"

    async def run_cameras():
        image = jpeg()
        session = f"student-{datetime.now(UTC):%H%M%S}"
        seq = 0
        await asyncio.sleep(1.0)
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{args.port}", headers={"authorization": f"Bearer {TOKEN}"}) as client:
            while True:
                if not camera["paused"]:
                    for cam in by_camera:
                        seq += 1
                        meta = {"session_id": session, "camera_id": cam, "seq": seq, "sim_time_ms": seq * 1000,
                                "captured_at": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
                        with contextlib.suppress(httpx.HTTPError):
                            await client.post(f"/api/v1/cameras/{cam}/frames", data={"metadata": json.dumps(meta)},
                                              files={"image": ("frame.jpg", image, "image/jpeg")})
                await asyncio.sleep(args.interval)

    async def serve():
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning"))
        await asyncio.gather(server.serve(), run_cameras(), run_traffic())

    asyncio.run(serve())


if __name__ == "__main__":
    main()
