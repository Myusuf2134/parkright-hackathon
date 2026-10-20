import asyncio
import io
import json
import os
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from parkright_contracts import FrameMetadata, OccupancyState, Point
from parkright_perception import CameraView, Frame, WatchedSpace, to_observations
from parkright_perception.a0.config import A0Config
from parkright_perception.a0.detector import (
    BackgroundAnchor,
    Detection,
    DetectionResult,
)
from parkright_perception.a0.provider import A0Provider
from PIL import Image

U, O, X = OccupancyState.UNCERTAIN, OccupancyState.OPEN, OccupancyState.OCCUPIED


def jpeg(color=None, size=(300, 300)):
    image = (
        Image.new("RGB", size, color)
        if color is not None
        else Image.fromarray(
            np.random.default_rng(42).integers(
                35, 210, (*size[::-1], 3), dtype=np.uint8
            )
        )
    )
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return buf.getvalue()


def frame(data=None):
    return Frame(
        FrameMetadata(
            session_id="test",
            camera_id="cam-01",
            seq=1,
            sim_time_ms=100,
            captured_at=datetime.now(UTC),
        ),
        jpeg() if data is None else data,
    )


def space(name="A1", left=0.1, right=0.4):
    return WatchedSpace(
        name,
        tuple(
            Point(x=x, y=y)
            for x, y in ((left, 0.1), (right, 0.1), (right, 0.9), (left, 0.9))
        ),
    )


VIEW = CameraView("cam-01", (space(), space("A2", 0.6, 0.9), WatchedSpace("A3", None)))


class Stub:
    identity = "TEST STUB deterministic raw detections"

    def __init__(self, detections=(), background=()):
        self.result = DetectionResult(tuple(detections), tuple(background))
        self.calls = []

    def detect(self, image):
        assert isinstance(image, Image.Image)
        self.calls.append(image.size)
        return self.result


def run(detections=(), data=None, view=VIEW, background=(), config=None):
    detector = Stub(detections, background)
    provider = A0Provider(detector, config)
    raw = asyncio.run(provider.infer(frame(data), view))
    return raw, detector, provider


@pytest.mark.parametrize(
    "data",
    [
        b"bad",
        b"\xff\xd8\xffbroken",
        jpeg("black"),
        jpeg("white"),
        jpeg("gray"),
        jpeg(size=(32, 32)),
    ],
)
def test_unusable_input(data):
    raw, detector, _ = run(data=data)
    assert all(r.state is U for r in raw)
    assert not detector.calls


def test_valid_decode_no_detections_is_not_open():
    raw, detector, p = run()
    assert detector.calls == [(300, 300)]
    assert all(r.state is U for r in raw)
    assert p.model.provider == "a0-test-stub"
    assert set(p.last_timings) == {
        "decode_ms",
        "inference_ms",
        "postprocess_ms",
        "total_ms",
    }


@pytest.mark.parametrize(
    "detection,expected",
    [
        (Detection("car", 0.9, (0.1, 0.1, 0.4, 0.9)), X),
        (Detection("truck", 0.9, (0.1, 0.1, 0.4, 0.9)), X),
        (Detection("car", 0.9, (0.38, 0.1, 0.5, 0.9)), U),
        (Detection("car", 0.2, (0.1, 0.1, 0.4, 0.9)), U),
        (Detection("car", 0.99, (0.45, 0.1, 0.55, 0.9)), U),
        (Detection("person", 0.99, (0.1, 0.1, 0.4, 0.9)), U),
        (Detection("car", float("nan"), (0.1, 0.1, 0.4, 0.9)), U),
    ],
)
def test_overlap_and_class(detection, expected):
    raw, _, _ = run([detection])
    assert raw[0].state is expected
    assert raw[2].state is U


def test_multiple_and_spanning_vehicles():
    for detections in (
        [Detection("car", 0.9, (0.1, 0.1, 0.9, 0.9))],
        [
            Detection("car", 0.9, (0.1, 0.1, 0.4, 0.9)),
            Detection("truck", 0.8, (0.6, 0.1, 0.9, 0.9)),
        ],
    ):
        raw, _, _ = run(detections)
        assert [r.state for r in raw] == [X, X, U]


def anchors():
    return [
        BackgroundAnchor(x, y, 0.999)
        for x in (0.15, 0.2, 0.3, 0.35)
        for y in (0.2, 0.4, 0.6, 0.8)
    ]


def test_open_requires_explicit_enable_and_spatial_model_evidence():
    raw, _, _ = run(background=anchors())
    assert raw[0].state is U
    config = replace(A0Config(), allow_open=True)
    raw, _, p = run(background=anchors(), config=config)
    assert [r.state for r in raw] == [O, U, U]
    obs = to_observations(frame(), VIEW, p.model, raw)
    assert obs[0].confidence == 0.999 and obs[0].model == p.model
    for background in (
        (),
        anchors()[:4],
        [replace(a, confidence=0.9) for a in anchors()],
    ):
        assert run(background=background, config=config)[0][0].state is U
    for label in ("car", "person"):
        assert (
            run(
                [Detection(label, 0.1, (0.1, 0.1, 0.4, 0.9))],
                background=anchors(),
                config=config,
            )[0][0].state
            is U
        )


def test_bad_geometry_and_camera_mismatch():
    for polygon in (
        (),
        (Point(x=0, y=0),) * 3,
        (Point(x=-1, y=0), Point(x=1, y=0), Point(x=1, y=1)),
    ):
        raw, _, _ = run(view=CameraView("cam-01", (WatchedSpace("A1", polygon),)))
        assert raw[0].state is U
    assert all(r.state is U for r in run(view=CameraView("other", VIEW.spaces))[0])


def test_detector_failure_is_uncertain():
    class Broken(Stub):
        def detect(self, image):
            raise RuntimeError("offline")

    p = A0Provider(Broken())
    assert all(r.state is U for r in asyncio.run(p.infer(frame(), VIEW)))
    assert p.last_error == "RuntimeError"


def test_twelve_spaces_and_provenance_changes():
    view = CameraView(
        "cam-01", tuple(space(f"{row}{i}") for row in "AB" for i in range(1, 7))
    )
    raw, _, p = run([Detection("car", 0.9, (0.1, 0.1, 0.4, 0.9))], view=view)
    assert len(raw) == 12 and all(r.state in OccupancyState for r in raw)
    assert (
        p.model
        != A0Provider(Stub(), replace(A0Config(), occupied_confidence=0.8)).model
    )


def test_api_frame_to_websocket(tmp_path):
    from fastapi.testclient import TestClient
    from parkright_api.config import MVP_FIXTURE, Settings
    from parkright_api.main import create_app

    fixture = json.loads(MVP_FIXTURE.read_text())
    fixture["cameras"][0]["polygons"] = {
        "A1": [p.model_dump() for p in space().polygon]
    }
    path = tmp_path / "facility.json"
    path.write_text(json.dumps(fixture))
    provider = A0Provider(Stub([Detection("car", 0.9, (0.1, 0.1, 0.4, 0.9))]))
    app = create_app(
        Settings(env="test", facility_fixtures=[path], _env_file=None),
        perception=provider,
    )
    f = frame()
    with (
        TestClient(app) as client,
        client.websocket_connect("/api/v1/realtime?facility_id=garage-01") as ws,
    ):
        assert ws.receive_json()["type"] == "facility_snapshot"
        response = client.post(
            "/api/v1/cameras/cam-01/frames",
            data={"metadata": f.metadata.model_dump_json()},
            files={"image": ("frame.jpg", f.jpeg, "image/jpeg")},
        )
        assert response.status_code == 202
        assert len(response.json()["observations"]) == 12
        update = ws.receive_json()
        assert update["counts"] == {
            "total": 12,
            "open": 0,
            "occupied": 1,
            "uncertain": 11,
        }
        assert update["spaces"][0]["model"] == provider.model.model_dump()


@pytest.mark.skipif(
    not os.getenv("PARKRIGHT_A0_REAL_SMOKE"),
    reason="requires explicit NVIDIA weights/source",
)
def test_real_model_smoke():
    from parkright_perception.a0.nvidia_ssd import NvidiaSSD

    d = NvidiaSSD(
        Path(os.environ["PARKRIGHT_A0_SOURCE"]),
        Path(os.environ["PARKRIGHT_A0_WEIGHTS"]),
    )
    result = d.detect(Image.open(io.BytesIO(jpeg())))
    assert len(result.background) == 8732
    assert all(0 <= a.confidence <= 1 for a in result.background)
    assert not d.identity.startswith("TEST STUB")
