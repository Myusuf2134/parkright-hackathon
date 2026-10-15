"""The first milestone, end to end over real sockets:

    JPEG frame → POST /api/v1/cameras/cam-01/frames → dummy PerceptionProvider
    → OPEN/OCCUPIED/UNCERTAIN → state → realtime event (WebSocket) → GET /spaces
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
import websockets

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "slice-test-token-0123456789abcdef"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def api():
    port = free_port()
    env = os.environ | {"PARKRIGHT_ENV": "development", "PARKRIGHT_PORT": str(port), "PARKRIGHT_INGEST_TOKEN": TOKEN}
    proc = subprocess.Popen([sys.executable, "-m", "parkright_api"], env=env, cwd=ROOT / "tests", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(f"{base}/api/v1/health").status_code == 200:
                break
        except httpx.TransportError:
            time.sleep(0.1)
    else:
        proc.kill()
        raise RuntimeError(proc.stdout.read().decode() if proc.stdout else "API did not start")
    yield base
    proc.terminate()
    proc.wait(5)


def jpeg() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (320, 180), (60, 60, 60)).save(buf, format="JPEG")
    return buf.getvalue()


def post_frame(base: str, seq: int) -> httpx.Response:
    metadata = {"session_id": "slice", "camera_id": "cam-01", "seq": seq, "sim_time_ms": seq * 500, "captured_at": datetime.now(UTC).isoformat()}
    return httpx.post(
        f"{base}/api/v1/cameras/cam-01/frames",
        data={"metadata": json.dumps(metadata)},
        files={"image": ("frame.jpg", jpeg(), "image/jpeg")},
        headers={"authorization": f"Bearer {TOKEN}"},
    )


def test_frame_to_browser_event(api):
    async def scenario():
        async with websockets.connect(api.replace("http", "ws") + "/api/v1/realtime?facility_id=garage-01") as ws:
            snapshot = json.loads(await asyncio.wait_for(ws.recv(), 5))
            assert snapshot["type"] == "facility_snapshot"
            response = await asyncio.to_thread(post_frame, api, 0)
            assert response.status_code == 202, response.text
            assert {o["state"] for o in response.json()["observations"]} == {"UNCERTAIN"}
            update = json.loads(await asyncio.wait_for(ws.recv(), 5))
            return update

    update = asyncio.run(scenario())
    assert update["type"] == "occupancy_update" and update["frame"]["seq"] == 0
    assert update["counts"] == {"total": 12, "open": 0, "occupied": 0, "uncertain": 12}
    assert all(s["model"] == {"provider": "none", "version": "0"} for s in update["spaces"])

    spaces = httpx.get(f"{api}/api/v1/facilities/garage-01/spaces").json()
    assert spaces["counts"]["open"] == 0 and spaces["spaces"][0]["frame_seq"] == 0


def test_ingest_requires_the_token(api):
    metadata = {"session_id": "x", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0, "captured_at": datetime.now(UTC).isoformat()}
    res = httpx.post(f"{api}/api/v1/cameras/cam-01/frames", data={"metadata": json.dumps(metadata)}, files={"image": ("f.jpg", jpeg(), "image/jpeg")})
    assert res.status_code == 401
