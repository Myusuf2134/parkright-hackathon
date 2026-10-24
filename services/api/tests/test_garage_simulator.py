"""3D garage simulator against the unchanged API: its calibration loads, its CAM-01 JPEGs go
through the existing ingest path, simulator ground truth cannot reach perception state, OPEN
stays disabled, and the hackathon demo still works on garage frames."""

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from parkright_api.config import Settings
from parkright_api.demo.app import create_demo_app
from parkright_api.main import create_app
from parkright_contracts import FacilityConfig, OccupancyState
from parkright_perception.a0.config import A0Config

from .conftest import ScriptedProvider, meta

ROOT = Path(__file__).resolve().parents[3]
GARAGE = ROOT / "packages/shared/calibration/garage"
CAL = json.loads((GARAGE / "cam-01.json").read_text())
JPEG = (Path(__file__).parent / "fixtures/garage-cam-01-static-day.jpg").read_bytes()
TOKEN = "garage-test-token"
AUTH = {"authorization": f"Bearer {TOKEN}"}
SPACES = [f"{r}{i}" for r in "AB" for i in range(1, 7)]


def settings(**extra) -> Settings:
    return Settings(
        env="test", _env_file=None, ingest_token=TOKEN, evaluation_enabled=True,
        calibration_file=GARAGE / "cam-01.json", facility_fixtures=[GARAGE / "facility.json"], **extra,
    )


@pytest.fixture
def provider() -> ScriptedProvider:
    p = ScriptedProvider()
    p.all(OccupancyState.UNCERTAIN, None, A1=(OccupancyState.OCCUPIED, 0.97), B2=(OccupancyState.OCCUPIED, 0.95))
    return p


def bind(client: TestClient, session: str = "garage-run") -> None:
    r = client.post("/api/v1/cameras/cam-01/calibration", headers=AUTH, json={"session_id": session, "version": CAL["version"], "pose": CAL["pose"]})
    assert r.status_code == 200, r.text


def upload(client: TestClient, seq: int, session: str = "garage-run", image: bytes = JPEG):
    return client.post(
        "/api/v1/cameras/cam-01/frames", headers=AUTH,
        data={"metadata": json.dumps(meta(seq, session_id=session))},
        files={"image": ("frame.jpg", image, "image/jpeg")},
    )


def test_garage_calibration_is_accepted_by_the_unchanged_api(provider):
    with TestClient(create_app(settings(), perception=provider)) as c:
        cal = c.get("/api/v1/health").json()["calibration"]
        assert cal["version"] == CAL["version"] and cal["camera_id"] == "cam-01"
        assert sorted(cal["polygons"]) == sorted(SPACES) and cal["unobservable"] == []
    facility = FacilityConfig.model_validate(json.loads((GARAGE / "facility.json").read_text()))
    assert [c.camera_id for c in facility.cameras] == ["cam-01"]
    assert sorted(facility.cameras[0].watches) == sorted(SPACES)


def test_rendered_garage_jpeg_goes_through_the_existing_ingest_path(provider):
    with Image.open(io.BytesIO(JPEG)) as img:
        assert img.format == "JPEG" and img.size == (1280, 720)
    with TestClient(create_app(settings(), perception=provider)) as c:
        assert upload(c, 1).status_code == 409  # unbound session: calibration required, as for the legacy lab
        bind(c)
        r = upload(c, 1)
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["camera_id"] == "cam-01" and body["outcome"] == "accepted"
        frame, view = provider.calls[-1]
        assert frame.jpeg == JPEG  # perception gets exactly the uploaded pixels
        assert view.camera_id == "cam-01" and {s.space_id for s in view.spaces} == set(SPACES)
        assert all(s.polygon is not None for s in view.spaces)
        states = {s["space_id"]: s["current_state"] for s in c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]}
        assert states["A1"] == "OCCUPIED" and states["B2"] == "OCCUPIED"
        assert "OPEN" not in states.values()


def test_wrong_pose_or_size_is_refused(provider):
    with TestClient(create_app(settings(), perception=provider)) as c:
        legacy_pose = json.loads((ROOT / "packages/shared/calibration/cam-01.json").read_text())["pose"]
        r = c.post("/api/v1/cameras/cam-01/calibration", headers=AUTH, json={"session_id": "s", "version": CAL["version"], "pose": legacy_pose})
        assert r.status_code == 409
        bind(c)
        small = io.BytesIO()
        Image.open(io.BytesIO(JPEG)).resize((640, 360)).save(small, format="JPEG")
        assert upload(c, 1, image=small.getvalue()).status_code == 409


def test_garage_ground_truth_cannot_reach_perception_state(provider):
    with TestClient(create_app(settings(), perception=provider)) as c:
        bind(c)
        assert upload(c, 1).status_code == 202
        before = c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]
        # Simulator ground truth says every bay is occupied, including bays the camera reads UNCERTAIN.
        truth = {"session_id": "garage-run", "camera_id": "cam-01", "seq": 1, "sim_time_ms": 100, "environment_preset": "clear_day",
                 "spaces": [{"space_id": s, "truth": "occupied"} for s in SPACES]}
        assert c.post("/api/v1/evaluation/ground-truth", headers=AUTH, json=truth).status_code in (200, 201, 202)
        after = c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]
        assert [(s["space_id"], s["current_state"]) for s in after] == [(s["space_id"], s["current_state"]) for s in before]
        # Ground truth cannot ride along with a frame either.
        r = c.post("/api/v1/cameras/cam-01/frames", headers=AUTH,
                   data={"metadata": json.dumps(meta(2, session_id="garage-run")), "truth": json.dumps(truth)},
                   files={"image": ("frame.jpg", JPEG, "image/jpeg")})
        assert r.status_code == 400 and r.json()["error"]["code"] == "unexpected_part"
        # Perception only ever saw pixels.
        for frame, _ in provider.calls:
            assert not hasattr(frame, "truth") and set(frame.metadata.model_dump()) == {"session_id", "camera_id", "seq", "sim_time_ms", "captured_at"}


def test_open_stays_disabled_with_the_garage_calibration():
    assert A0Config().allow_open is False
    assert "allow_open" not in json.dumps(CAL) and "threshold" not in json.dumps(CAL)


def test_hackathon_demo_runs_on_garage_frames(provider):
    with TestClient(create_demo_app(settings(demo_mode=True), perception=provider)) as c:
        bind(c)
        assert upload(c, 1).status_code == 202
        status = c.get("/api/v1/demo/status").json()
        assert status["camera"]["occupied"] == ["A1", "B2"] and status["camera"]["open"] == []
        assert status["calibration"] == CAL["polygons"]
        p = c.post("/api/v1/demo/recommendation").json()["presentation"]
        assert (p["garage"], p["level"], p["space_id"], p["walking_minutes"]) == ("Tuttle Garage", "Level 2", "B12", 4)
        assert c.get("/api/v1/demo/camera/latest.jpg").content == JPEG


@pytest.mark.skipif(not (Path.home() / ".cache/parkright/models/a2-fasterrcnn/best.pt").exists(), reason="A2 checkpoint not present")
def test_real_a2_on_a_rendered_garage_frame():
    """Real A2, unchanged thresholds, on the committed garage frame: never OPEN; every truly parked bay found."""
    from parkright_perception.a2.provider import from_environment

    # Cold start under load can exceed the 10 s default; the timeout is not a safety setting.
    with TestClient(create_app(settings(perception_timeout_s=60), perception=from_environment())) as c:
        import time

        deadline = time.monotonic() + 120
        while not c.get("/api/v1/health").json()["inference"].get("inference_ready"):
            assert time.monotonic() < deadline, "A2 did not warm up"
            time.sleep(0.5)
        bind(c)
        r = upload(c, 1)
        assert r.status_code == 202, r.text
        obs ={o["space_id"]: o["state"] for o in r.json()["observations"]}
        assert "OPEN" not in obs.values()
        assert {"A1", "A3", "B2", "B5"} <= {s for s, v in obs.items() if v == "OCCUPIED"}
