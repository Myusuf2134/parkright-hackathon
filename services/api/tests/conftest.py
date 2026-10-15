import io
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from parkright_api.config import Settings
from parkright_api.main import create_app
from parkright_contracts import ModelRef, OccupancyState
from parkright_perception import CameraView, Frame, SpaceInference

SPACES = [f"{r}{i}" for r in "AB" for i in range(1, 7)]
CAMERA = "cam-01"
FACILITY = "garage-01"


def make_jpeg(size: tuple[int, int] = (64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (90, 90, 90)).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


JPEG = make_jpeg()


class ScriptedProvider:
    """A provider whose answers the test controls, recording exactly what it was given."""

    model = ModelRef(provider="test-arm", version="1")

    def __init__(self) -> None:
        self.calls: list[tuple[Frame, CameraView]] = []
        self.answer: Callable[[CameraView], list[SpaceInference]] = lambda view: []
        self.delay_s = 0.0

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]:
        self.calls.append((frame, view))
        if self.delay_s:
            import asyncio

            await asyncio.sleep(self.delay_s)
        return self.answer(view)

    def all(self, state: OccupancyState, confidence: float | None, **overrides: tuple[OccupancyState, float | None]) -> None:
        def answer(view: CameraView) -> list[SpaceInference]:
            return [SpaceInference(s.space_id, *overrides.get(s.space_id, (state, confidence))) for s in view.spaces]

        self.answer = answer


@pytest.fixture
def provider() -> ScriptedProvider:
    return ScriptedProvider()


@pytest.fixture
def make_client(provider):
    clients: list[TestClient] = []

    def make(**settings) -> TestClient:
        client = TestClient(create_app(Settings(env="test", _env_file=None, **settings), perception=provider))
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def meta(seq: int, **over) -> dict:
    return {
        "session_id": "run-1",
        "camera_id": CAMERA,
        "seq": seq,
        "sim_time_ms": seq * 100,
        "captured_at": (datetime.now(UTC) - timedelta(milliseconds=20)).isoformat(),
    } | over


def send(client: TestClient, metadata=None, image: bytes | None = JPEG, image_type: str = "image/jpeg", camera: str = CAMERA, extra: dict | None = None, headers: dict | None = None):
    data = {}
    if metadata is not None:
        data["metadata"] = metadata if isinstance(metadata, str) else json.dumps(metadata)
    data |= extra or {}
    files = {"image": ("frame.jpg", image, image_type)} if image is not None else None
    return client.post(f"/api/v1/cameras/{camera}/frames", data=data, files=files, headers=headers or {})


def occupancy(client: TestClient) -> dict:
    return client.get(f"/api/v1/facilities/{FACILITY}/spaces").json()


def state_of(o: dict, space_id: str) -> dict:
    return next(s for s in o["spaces"] if s["space_id"] == space_id)
