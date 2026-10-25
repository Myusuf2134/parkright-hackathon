"""Ohio Union North Garage-inspired simulation (72 spaces, eight cameras) against the API: the same
multi-camera path as the 34-space showcase, at the new site. Per-camera calibrations, exclusive
half-row ownership, one shared 72-space state, the site label on the demo status, OPEN disabled,
and the 34-space showcase left as it was."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from parkright_api.calibration import CalibrationSet
from parkright_api.config import Settings
from parkright_api.demo.app import create_demo_app
from parkright_contracts import FacilityConfig, OccupancyState
from parkright_perception import SpaceInference
from parkright_perception.a0.config import A0Config

from .conftest import ScriptedProvider, meta
from .test_garage_showcase import AUTH, JPEG, TOKEN

ROOT = Path(__file__).resolve().parents[3]
OHIO = ROOT / "packages/shared/calibration/ohio-union"
CALS = {p.stem: json.loads(p.read_text()) for p in sorted(OHIO.glob("cam-*.json"))}
# Each camera owns one half-row: bays 1–9 (west of the spine) or 10–18 (east).
ZONES = {
    "cam-01": ("A", range(1, 10)), "cam-02": ("B", range(1, 10)), "cam-03": ("C", range(1, 10)), "cam-04": ("D", range(1, 10)),
    "cam-05": ("A", range(10, 19)), "cam-06": ("B", range(10, 19)), "cam-07": ("C", range(10, 19)), "cam-08": ("D", range(10, 19)),
}


def owned(cam: str) -> list[str]:
    row, nums = ZONES[cam]
    return [f"{row}{n}" for n in nums]


def settings(**extra) -> Settings:
    return Settings(env="test", _env_file=None, ingest_token=TOKEN, evaluation_enabled=True, demo_mode=True,
                    showcase_dir=OHIO, facility_fixtures=[OHIO / "facility.json"], **extra)


@pytest.fixture
def provider() -> ScriptedProvider:
    p = ScriptedProvider()
    p.all(OccupancyState.OCCUPIED, 0.95)
    return p


@pytest.fixture
def client(provider):
    with TestClient(create_demo_app(settings(stale_after_ms=30_000), perception=provider)) as c:
        yield c


def bind(c, cam: str):
    r = c.post(f"/api/v1/cameras/{cam}/calibration", headers=AUTH, json={"session_id": f"run-{cam}", "version": CALS[cam]["version"], "pose": CALS[cam]["pose"]})
    assert r.status_code == 200, r.text


def send(c, cam: str, seq: int = 1):
    return c.post(f"/api/v1/cameras/{cam}/frames", headers=AUTH,
                  data={"metadata": json.dumps(meta(seq, session_id=f"run-{cam}", camera_id=cam))},
                  files={"image": ("f.jpg", JPEG, "image/jpeg")})


def spaces(c) -> dict:
    return {s["space_id"]: s for s in c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]}


def test_eight_calibrations_load_with_exclusive_half_row_ownership():
    cs = CalibrationSet(sorted(OHIO.glob("cam-*.json")))
    assert sorted(cs.cameras) == [f"cam-0{i}" for i in range(1, 9)]
    all_owned = [s for cal in cs.cameras.values() for s in cal.data["polygons"]]
    assert len(all_owned) == 72 and len(set(all_owned)) == 72
    for cam, cal in cs.cameras.items():
        assert list(cal.data["polygons"]) == owned(cam)
        assert cal.data["version"] == f"ohio-union-v1-{cam}"
    facility = FacilityConfig.model_validate(json.loads((OHIO / "facility.json").read_text()))
    cs.check_facility(facility)
    assert facility.facility_id == "garage-01" and facility.is_simulated and len(facility.spaces) == 72
    assert "Ohio Union North Garage-inspired simulation" in facility.name


def test_each_camera_updates_only_its_half_row(client, provider):
    for cam in ["cam-02", "cam-07"]:
        bind(client, cam)
        assert send(client, cam).status_code == 202
        _, view = provider.calls[-1]
        assert view.camera_id == cam and [s.space_id for s in view.spaces] == owned(cam)
    st = spaces(client)
    assert {k for k, v in st.items() if v["current_state"] == "OCCUPIED"} == set(owned("cam-02")) | set(owned("cam-07"))
    assert all(st[s]["source_camera_id"] == "cam-07" for s in owned("cam-07"))


def test_eight_cameras_aggregate_into_one_72_space_state(client, provider):
    provider.answer = lambda view: [SpaceInference(s.space_id, OccupancyState.OCCUPIED if int(s.space_id[1:]) % 2 else OccupancyState.UNCERTAIN, 0.9 if int(s.space_id[1:]) % 2 else None) for s in view.spaces]
    for cam in ZONES:
        bind(client, cam)
        assert send(client, cam).status_code == 202
    st = spaces(client)
    assert len(st) == 72
    assert sorted(k for k, v in st.items() if v["current_state"] == "OCCUPIED") == sorted(k for k in st if int(k[1:]) % 2)
    for cam in ZONES:
        assert all(st[s]["source_camera_id"] == cam for s in owned(cam))
    counts = client.get("/api/v1/facilities").json()[0]["counts"]
    assert counts["total"] == 72 and counts["occupied"] == 36 and counts["open"] == 0


def test_websocket_carries_all_72_spaces(client):
    with client.websocket_connect("/api/v1/realtime?facility_id=garage-01") as ws:
        assert len(ws.receive_json()["spaces"]) == 72
        bind(client, "cam-05")
        assert send(client, "cam-05").status_code == 202
        m = ws.receive_json()
        assert m["type"] == "occupancy_update" and m["frame"]["camera_id"] == "cam-05"
        assert sorted(c["space_id"] for c in m["changes"]) == sorted(owned("cam-05"))
        assert len(m["spaces"]) == 72


def test_demo_status_names_the_site_and_never_claims_a_digital_twin(client):
    bind(client, "cam-08")
    send(client, "cam-08")
    st = client.get("/api/v1/demo/status").json()
    assert st["showcase"] is True
    assert st["site"]["site_id"] == "ohio-union"
    assert st["site"]["title"] == "Ohio Union North Garage-inspired simulation"
    assert "Not an official or exact digital twin" in st["site"]["disclaimer"]
    assert st["site"]["spaces"] == 72 and st["site"]["cameras"] == 8
    assert st["stale_after_s"] == 30
    cams = {c["camera_id"]: c for c in st["cameras"]}
    assert len(cams) == 8 and cams["cam-08"]["owned"] == owned("cam-08") and cams["cam-08"]["last_frame"]["seq"] == 1
    assert st["perception"]["allow_open"] is False
    # The recommendation is unchanged: it comes from the demo feed, not from the simulated site.
    p = client.post("/api/v1/demo/recommendation").json()["presentation"]
    assert (p["garage"], p["level"], p["space_id"]) == ("Tuttle Garage", "Level 2", "B12")


def test_ground_truth_cannot_update_ohio_state(client):
    bind(client, "cam-03")
    send(client, "cam-03")
    before = spaces(client)
    truth = {"session_id": "run-cam-03", "camera_id": "cam-03", "seq": 1, "sim_time_ms": 100, "environment_preset": "dusk",
             "spaces": [{"space_id": s, "truth": "empty"} for s in owned("cam-03")]}
    assert client.post("/api/v1/evaluation/ground-truth", headers=AUTH, json=truth).status_code in (200, 201, 202)
    assert spaces(client) == before


def test_34_space_showcase_status_is_unchanged(provider):
    """The fallback garage has no site.json: no site label, the default 12 s freshness, 34 spaces."""
    showcase = ROOT / "packages/shared/calibration/garage-showcase"
    s = Settings(env="test", _env_file=None, ingest_token=TOKEN, demo_mode=True, showcase_dir=showcase, facility_fixtures=[showcase / "facility.json"])
    with TestClient(create_demo_app(s, perception=provider)) as c:
        st = c.get("/api/v1/demo/status").json()
        assert st["site"] is None and st["stale_after_s"] == 12
        assert len(st["cameras"]) == 4 and len(spaces(c)) == 34


def test_open_stays_disabled_at_the_ohio_site():
    assert A0Config().allow_open is False
    text = "".join(p.read_text() for p in OHIO.glob("*.json"))
    assert "allow_open" not in text and "threshold" not in text
