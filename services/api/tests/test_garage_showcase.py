"""34-space, four-camera showcase against the API: per-camera calibrations, exclusive bay ownership,
one shared facility state, WebSocket updates, the perception event log, ground-truth isolation,
OPEN disabled, and the unchanged single-camera path."""

import io
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from parkright_api.calibration import Calibration, CalibrationSet
from parkright_api.config import Settings
from parkright_api.demo.app import create_demo_app
from parkright_contracts import FacilityConfig, OccupancyObservation, OccupancyState
from parkright_perception import SpaceInference
from parkright_perception.a0.config import A0Config

from .conftest import ScriptedProvider, meta

ROOT = Path(__file__).resolve().parents[3]
SHOWCASE = ROOT / "packages/shared/calibration/garage-showcase"
CALS = {p.stem: json.loads(p.read_text()) for p in sorted(SHOWCASE.glob("cam-*.json"))}
TOKEN = "showcase-test-token"
AUTH = {"authorization": f"Bearer {TOKEN}"}
ROWS = {"cam-01": "A", "cam-02": "B", "cam-03": "C", "cam-04": "D"}


def jpeg(size=(1280, 720)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (80, 82, 84)).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


JPEG = jpeg()


def settings(**extra) -> Settings:
    return Settings(env="test", _env_file=None, ingest_token=TOKEN, evaluation_enabled=True, demo_mode=True,
                    showcase_dir=SHOWCASE, facility_fixtures=[SHOWCASE / "facility.json"], **extra)


@pytest.fixture
def provider() -> ScriptedProvider:
    p = ScriptedProvider()
    p.all(OccupancyState.OCCUPIED, 0.95)  # every space the camera is asked about reads OCCUPIED
    return p


@pytest.fixture
def client(provider):
    with TestClient(create_demo_app(settings(), perception=provider)) as c:
        yield c


def bind(c, cam: str, session: str | None = None):
    session = session or f"run-{cam}"
    r = c.post(f"/api/v1/cameras/{cam}/calibration", headers=AUTH, json={"session_id": session, "version": CALS[cam]["version"], "pose": CALS[cam]["pose"]})
    assert r.status_code == 200, r.text
    return session


def send(c, cam: str, seq: int = 1, session: str | None = None, extra: dict | None = None):
    session = session or f"run-{cam}"
    return c.post(f"/api/v1/cameras/{cam}/frames", headers=AUTH,
                  data={"metadata": json.dumps(meta(seq, session_id=session, camera_id=cam)), **(extra or {})},
                  files={"image": ("f.jpg", JPEG, "image/jpeg")})


def spaces(c) -> dict:
    return {s["space_id"]: s for s in c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]}


# ---- calibrations -----------------------------------------------------------------------

def test_four_calibrations_load_with_exclusive_ownership():
    cs = CalibrationSet(sorted(SHOWCASE.glob("cam-*.json")))
    assert sorted(cs.cameras) == ["cam-01", "cam-02", "cam-03", "cam-04"]
    owned = [s for cal in cs.cameras.values() for s in cal.data["polygons"]]
    assert len(owned) == 34 and len(set(owned)) == 34
    for cam, cal in cs.cameras.items():
        assert all(s.startswith(ROWS[cam]) for s in cal.data["polygons"])
    facility = FacilityConfig.model_validate(json.loads((SHOWCASE / "facility.json").read_text()))
    cs.check_facility(facility)
    assert len(facility.spaces) == 34


def test_overlapping_or_duplicate_calibrations_are_refused(tmp_path):
    for p in SHOWCASE.glob("cam-*.json"):
        shutil.copy(p, tmp_path / p.name)
    bad = json.loads((tmp_path / "cam-02.json").read_text())
    bad["polygons"]["A1"] = CALS["cam-01"]["polygons"]["A1"]  # cam-02 claims a bay cam-01 owns
    (tmp_path / "cam-02.json").write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="A1"):
        CalibrationSet(sorted(tmp_path.glob("cam-*.json")))
    (tmp_path / "cam-02.json").write_text(json.dumps(CALS["cam-02"]))
    (tmp_path / "cam-05.json").write_text(json.dumps({**CALS["cam-01"], "polygons": {}}))
    with pytest.raises(ValueError, match="two calibrations"):
        CalibrationSet(sorted(tmp_path.glob("cam-*.json")))


def test_single_camera_calibration_identity_is_unchanged():
    with pytest.raises(ValueError, match="identity"):
        Calibration(SHOWCASE / "cam-02.json")  # the production loader still accepts only cam-01
    cal = Calibration(ROOT / "packages/shared/calibration/cam-01.json")
    assert cal.for_camera("cam-01") is cal and cal.for_camera("cam-02") is None


def test_each_camera_binds_only_to_its_own_calibration(client):
    r = client.post("/api/v1/cameras/cam-02/calibration", headers=AUTH, json={"session_id": "x", "version": CALS["cam-01"]["version"], "pose": CALS["cam-01"]["pose"]})
    assert r.status_code == 409
    assert send(client, "cam-02").status_code == 409  # unbound session
    bind(client, "cam-02")
    assert send(client, "cam-02").status_code == 202


# ---- ownership and aggregation -----------------------------------------------------------

def test_each_camera_updates_only_its_owned_bays(client, provider):
    bind(client, "cam-02")
    assert send(client, "cam-02").status_code == 202
    _, view = provider.calls[-1]
    assert view.camera_id == "cam-02" and [s.space_id for s in view.spaces] == [f"B{i}" for i in range(1, 9)]
    st = spaces(client)
    assert {k for k, v in st.items() if v["current_state"] == "OCCUPIED"} == {f"B{i}" for i in range(1, 9)}
    assert all(st[f"B{i}"]["source_camera_id"] == "cam-02" for i in range(1, 9))
    assert all(v["current_state"] == "UNCERTAIN" for k, v in st.items() if not k.startswith("B"))


def test_state_refuses_observations_from_a_non_owner(client):
    """Defence in depth: even if a provider reported a bay it does not own, the state ignores it."""
    facility = client.app.state.registry.get("garage-01")
    from datetime import UTC, datetime

    from parkright_contracts import ModelRef

    model = ModelRef(provider="test", version="1")
    now = datetime.now(UTC)
    common = dict(camera_id="cam-02", session_id="s", frame_seq=1, sim_time_ms=0, captured_at=now, state=OccupancyState.OCCUPIED, confidence=0.99, model=model)
    rogue = OccupancyObservation(space_id="A1", **common)
    own = OccupancyObservation(space_id="B1", **common)
    changes = facility.apply([rogue, own], now)
    assert [c.space_id for c in changes] == ["B1"]
    st = spaces(client)
    assert st["A1"]["current_state"] == "UNCERTAIN" and st["B1"]["current_state"] == "OCCUPIED"


def test_four_cameras_aggregate_into_one_34_space_state(client, provider):
    for i, cam in enumerate(["cam-01", "cam-02", "cam-03", "cam-04"]):
        # Each camera reports its own row; alternate bays occupied.
        provider.answer = lambda view: [SpaceInference(s.space_id, OccupancyState.OCCUPIED if int(s.space_id[1:]) % 2 else OccupancyState.UNCERTAIN, 0.9 if int(s.space_id[1:]) % 2 else None) for s in view.spaces]
        bind(client, cam)
        assert send(client, cam).status_code == 202
    st = spaces(client)
    assert len(st) == 34
    assert sorted(k for k, v in st.items() if v["current_state"] == "OCCUPIED") == sorted(k for k in st if int(k[1:]) % 2)
    for k, v in st.items():
        assert v["source_camera_id"] == {"A": "cam-01", "B": "cam-02", "C": "cam-03", "D": "cam-04"}[k[0]]
    counts = client.get("/api/v1/facilities").json()[0]["counts"]
    assert counts["total"] == 34 and counts["occupied"] == 18 and counts["open"] == 0


def test_websocket_pushes_every_camera_update(client):
    with client.websocket_connect("/api/v1/realtime?facility_id=garage-01") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "facility_snapshot" and len(snap["spaces"]) == 34
        for cam in ["cam-03", "cam-01"]:
            bind(client, cam)
            assert send(client, cam).status_code == 202
            m = ws.receive_json()
            assert m["type"] == "occupancy_update" and m["frame"]["camera_id"] == cam
            assert {c["space_id"][0] for c in m["changes"]} == {ROWS[cam]}
            assert len(m["spaces"]) == 34


def test_event_log_records_real_frames_and_changes(client):
    bind(client, "cam-04")
    send(client, "cam-04", 1)
    send(client, "cam-04", 2)
    ev = client.get("/api/v1/demo/events").json()["events"]
    assert [e["camera_id"] for e in ev] == ["cam-04", "cam-04"]
    assert sorted(c["space_id"] for c in ev[0]["changes"]) == [f"D{i}" for i in range(1, 10)]
    assert ev[1]["changes"] == []  # nothing changed the second time
    assert client.get(f"/api/v1/demo/events?after={ev[0]['id']}").json()["events"] == ev[1:]
    client.post("/api/v1/demo/reset")
    assert client.get("/api/v1/demo/events").json()["events"] == []


def test_demo_status_lists_cameras_and_latest_frames(client):
    bind(client, "cam-01")
    send(client, "cam-01")
    st = client.get("/api/v1/demo/status").json()
    assert st["showcase"] is True and st["calibration"] is None
    cams = {c["camera_id"]: c for c in st["cameras"]}
    assert sorted(cams) == ["cam-01", "cam-02", "cam-03", "cam-04"]
    assert cams["cam-01"]["owned"] == [f"A{i}" for i in range(1, 10)] and cams["cam-01"]["last_frame"]["seq"] == 1
    assert cams["cam-02"]["last_frame"] is None and cams["cam-02"]["polygons"] == CALS["cam-02"]["polygons"]
    assert client.get("/api/v1/demo/camera/latest.jpg?camera_id=cam-01").content == JPEG
    assert client.get("/api/v1/demo/camera/latest.jpg?camera_id=cam-03").status_code == 404
    p = client.post("/api/v1/demo/recommendation").json()["presentation"]
    assert (p["garage"], p["level"], p["space_id"]) == ("Tuttle Garage", "Level 2", "B12")


# ---- ground truth and OPEN -----------------------------------------------------------------

def test_ground_truth_cannot_update_facility_state(client):
    bind(client, "cam-02")
    send(client, "cam-02")
    before = spaces(client)
    truth = {"session_id": "run-cam-02", "camera_id": "cam-02", "seq": 1, "sim_time_ms": 100, "environment_preset": "night",
             "spaces": [{"space_id": f"B{i}", "truth": "empty"} for i in range(1, 9)]}
    assert client.post("/api/v1/evaluation/ground-truth", headers=AUTH, json=truth).status_code in (200, 201, 202)
    assert spaces(client) == before
    r = send(client, "cam-02", 2, extra={"truth": json.dumps(truth)})
    assert r.status_code == 400 and r.json()["error"]["code"] == "unexpected_part"


def test_state_comes_only_from_perception(client, provider):
    provider.all(OccupancyState.UNCERTAIN, None)
    bind(client, "cam-03")
    send(client, "cam-03")
    assert all(v["current_state"] == "UNCERTAIN" for v in spaces(client).values())


def test_open_stays_disabled():
    assert A0Config().allow_open is False
    text = (SHOWCASE / "facility.json").read_text() + "".join(json.dumps(c) for c in CALS.values())
    assert "allow_open" not in text and "threshold" not in text


def test_showcase_settings_cannot_be_combined_with_a_single_calibration(provider):
    with pytest.raises(ValueError, match="either"):
        create_demo_app(settings(calibration_file=ROOT / "packages/shared/calibration/cam-01.json"), perception=provider)
