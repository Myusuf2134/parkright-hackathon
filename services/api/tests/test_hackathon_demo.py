"""Hackathon demo mode: fixture, reset, OPEN stays disabled, fallback/live modes, grounding,
no secrets, startup checks. The production app (create_app) is unchanged and never loads
any of this; see test_demo_code_is_not_loaded_by_production."""

import json
import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from parkright_api.config import Settings
from parkright_api.demo.app import create_demo_app
from parkright_api.demo.fixtures import DEMO_FIXTURE, DemoScenario, fixture_sha256, load_scenario
from parkright_api.recommendations.client import MODEL, NemotronClient
from parkright_contracts import OccupancyState
from parkright_perception.a0.config import A0Config

from .conftest import ScriptedProvider, meta, send

ROOT = Path(__file__).resolve().parents[3]
FAKE_KEY = "nb-test-key-must-never-appear-anywhere-0123456789"
PARKED = ["A1", "A3", "B2", "B5"]


@pytest.fixture
def provider() -> ScriptedProvider:
    p = ScriptedProvider()
    p.all(OccupancyState.UNCERTAIN, None, **{s: (OccupancyState.OCCUPIED, 0.93) for s in PARKED})
    return p


@pytest.fixture
def make_demo(provider):
    clients = []

    def make(**settings) -> TestClient:
        c = TestClient(create_demo_app(Settings(env="test", _env_file=None, demo_mode=True, **settings), perception=provider))
        c.__enter__()
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def frame(client, seq=1, session="demo-run"):
    r = send(client, meta(seq, session_id=session))
    assert r.status_code == 202, r.text
    return r


def nemotron(choice: dict, calls: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "demo-test", "model": MODEL, "choices": [
            {"finish_reason": "stop", "message": {"content": json.dumps(choice)}},
        ]})
    return httpx.MockTransport(handler)


TUTTLE_CHOICE = {
    "selected_facility_id": "tuttle-garage", "recommendation_code": "RECOMMEND",
    "reason_codes": ["CONFIRMED_AVAILABILITY", "SHORTER_WALK"], "uncertainty_codes": [],
}


# 1. Seed reproducibility ------------------------------------------------------------------

def test_fixture_pins_one_simulator_scene():
    s = load_scenario()
    assert (s.simulator.seed, s.simulator.environment, s.simulator.occupied_bays) == (4242, "clear_day", PARKED)
    assert s.simulator.hash == "seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0"
    # The hash is the only scene the simulator's demo mode loads; it encodes exactly the fixture's bays.
    occ = dict(p.split("=") for p in s.simulator.hash.split("&"))["occ"].split(",")
    assert sorted(o.split(".")[0] for o in occ) == sorted(s.simulator.occupied_bays)


def test_fixture_is_byte_stable_and_reloads_identically():
    assert fixture_sha256() == fixture_sha256()
    assert DemoScenario.model_validate(json.loads(DEMO_FIXTURE.read_text())) == load_scenario()


# 2. Demo reset ----------------------------------------------------------------------------

def test_reset_returns_to_the_known_starting_state(make_demo):
    c = make_demo()
    frame(c, 1)
    frame(c, 2)
    before = c.get("/api/v1/demo/status").json()
    assert before["camera"]["occupied"] == PARKED and before["frames_since_reset"] == 2
    assert c.get("/api/v1/demo/camera/latest.jpg").status_code == 200

    r = c.post("/api/v1/demo/reset").json()
    assert r == {"reset": True, "epoch": before["epoch"] + 1, "scenario_id": "hackathon-tuttle-dreese-v1"}
    after = c.get("/api/v1/demo/status").json()
    assert after["camera"]["occupied"] == [] and after["camera"]["live_bays"] == 0 and not after["camera"]["fresh"]
    assert after["camera"]["last_frame"] is None and after["frames_since_reset"] == 0
    assert c.get("/api/v1/demo/camera/latest.jpg").status_code == 404
    assert c.post("/api/v1/demo/recommendation").status_code == 409
    spaces = c.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]
    assert all(s["current_state"] == "UNCERTAIN" and s["last_observed_at"] is None for s in spaces)
    # Stream history is cleared too: the same session can start again at seq 1.
    frame(c, 1)
    assert c.get("/api/v1/demo/status").json()["camera"]["occupied"] == PARKED


def test_reset_publishes_a_blank_state_to_live_clients(make_demo):
    c = make_demo()
    frame(c, 1)
    with c.websocket_connect("/api/v1/realtime?facility_id=garage-01") as ws:
        assert ws.receive_json()["type"] == "facility_snapshot"
        c.post("/api/v1/demo/reset")
        update = ws.receive_json()
        assert update["type"] == "occupancy_update"
        assert update["counts"] == {"open": 0, "occupied": 0, "uncertain": 12, "total": 12}


# 3. Exact fixture data --------------------------------------------------------------------

def test_exact_fixture_values():
    s = load_scenario()
    assert s.student.name == "Mahdi"
    assert (s.next_class.time, s.next_class.destination) == ("10:20 AM", "Dreese Laboratories")
    got = [(c.facility_id, c.name, c.walking_minutes, c.traffic, c.demo_available_spaces, c.demo_space.level, c.demo_space.space_id) for c in s.candidates]
    assert got == [
        ("tuttle-garage", "Tuttle Garage", 4, "moderate", 46, "Level 2", "B12"),
        ("lane-avenue-garage", "Lane Avenue Garage", 7, "moderate", 23, "Level 3", "C18"),
        ("ohio-union-garage", "Ohio Union Garage", 11, "heavy", 31, "Level 1", "A07"),
    ]
    assert s.expected.model_dump() == {
        "facility_id": "tuttle-garage", "garage": "Tuttle Garage", "level": "Level 2", "space_id": "B12",
        "walking_minutes": 4, "camera_occupied_bays": PARKED,
    }
    assert "not live" in s.disclaimer


def test_fixture_rejects_inconsistent_expectations():
    raw = json.loads(DEMO_FIXTURE.read_text())
    raw["expected"]["space_id"] = "B14"
    with pytest.raises(ValidationError):
        DemoScenario.model_validate(raw)


# 4. allow_open stays false ----------------------------------------------------------------

def test_open_stays_disabled_everywhere():
    assert A0Config().allow_open is False
    a2 = (ROOT / "services/perception/src/parkright_perception/a2/provider.py").read_text()
    assert "A0Provider(detector, A0Config())" in a2  # the A2 factory takes no threshold overrides


def test_demo_never_reports_open_and_status_reads_the_running_mapper(make_demo, provider):
    c = make_demo()
    status = c.get("/api/v1/demo/status").json()
    assert status["perception"]["allow_open"] is False
    frame(c, 1)
    status = c.get("/api/v1/demo/status").json()
    assert status["camera"]["open"] == []
    assert sorted(status["camera"]["uncertain"]) == sorted(set(f"{r}{i}" for r in "AB" for i in range(1, 7)) - set(PARKED))


def test_demo_mode_is_refused_in_production():
    with pytest.raises(ValidationError):
        Settings(env="production", ingest_token="t" * 32, demo_mode=True, _env_file=None)
    with pytest.raises(ValueError):
        create_demo_app(Settings(env="test", _env_file=None))  # demo routes need PARKRIGHT_DEMO_MODE=1


def test_demo_code_is_not_loaded_by_production():
    code = (
        "import sys\n"
        "from parkright_api.config import Settings\n"
        "from parkright_api.main import create_app\n"
        "app = create_app(Settings(env='production', ingest_token='t'*32, _env_file=None))\n"
        "assert not [m for m in sys.modules if m.startswith('parkright_api.demo') or m == 'parkright_api.routes.demo']\n"
        "assert not [r.path for r in app.routes if '/demo' in getattr(r, 'path', '')]\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


# 5. Fallback recommendation ---------------------------------------------------------------

def test_fallback_mode_never_calls_nemotron_even_with_a_key(make_demo):
    c = make_demo(demo_nemotron="fallback")
    calls: list = []
    c.app.state.nemotron = NemotronClient(api_key=FAKE_KEY, transport=nemotron(TUTTLE_CHOICE, calls))
    frame(c, 1)
    body = c.post("/api/v1/demo/recommendation").json()
    assert calls == []
    p = body["presentation"]
    assert (p["facility_id"], p["level"], p["space_id"], p["walking_minutes"], p["source"]) == ("tuttle-garage", "Level 2", "B12", 4, "fallback")
    assert p["source_label"] == "Local fallback: the demo is in fallback mode, so NVIDIA Nemotron was not called."
    assert body["result"]["provenance"]["attempted"] is False


def test_fallback_is_deterministic_across_resets(make_demo):
    c = make_demo()
    seen = set()
    for _ in range(5):
        c.post("/api/v1/demo/reset")
        frame(c, 1)
        seen.add(json.dumps(c.post("/api/v1/demo/recommendation").json()["presentation"], sort_keys=True))
    assert len(seen) == 1


# 6. Live-mode config parsing --------------------------------------------------------------

def test_live_mode_parsing(monkeypatch):
    monkeypatch.setenv("PARKRIGHT_DEMO_MODE", "1")
    monkeypatch.setenv("PARKRIGHT_DEMO_NEMOTRON", "live")
    s = Settings(_env_file=None)
    assert (s.demo_mode, s.demo_nemotron) == (True, "live")
    monkeypatch.setenv("PARKRIGHT_DEMO_NEMOTRON", "LIVE!")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
    monkeypatch.delenv("PARKRIGHT_DEMO_NEMOTRON")
    assert Settings(_env_file=None).demo_nemotron == "fallback"  # deterministic by default


def test_live_mode_uses_nemotron_and_validates_it(make_demo):
    c = make_demo(demo_nemotron="live")
    calls: list = []
    c.app.state.nemotron = NemotronClient(api_key=FAKE_KEY, transport=nemotron(TUTTLE_CHOICE, calls))
    assert {"mode": "live", "live_configured": True, "will_call_nemotron": True}.items() <= c.get("/api/v1/demo/status").json()["nemotron"].items()
    frame(c, 1)
    body = c.post("/api/v1/demo/recommendation").json()
    assert len(calls) == 1
    sent = json.loads(calls[0]["messages"][1]["content"])
    assert [f["facility_id"] for f in sent["facilities"]] == ["tuttle-garage", "lane-avenue-garage", "ohio-union-garage"]
    assert sent["destination"] == "Dreese Laboratories"
    p = body["presentation"]
    assert (p["source"], p["garage"], p["level"], p["space_id"]) == ("nemotron", "Tuttle Garage", "Level 2", "B12")
    assert p["source_label"].startswith("Chosen by NVIDIA Nemotron via Nebius Token Factory")


def test_live_mode_without_a_key_falls_back_and_says_so(make_demo):
    c = make_demo(demo_nemotron="live")
    c.app.state.nemotron = NemotronClient(api_key="")
    frame(c, 1)
    p = c.post("/api/v1/demo/recommendation").json()["presentation"]
    assert (p["source"], p["space_id"]) == ("fallback", "B12")
    assert "NEBIUS_API_KEY is not set" in p["source_label"]


def test_ungrounded_model_answer_is_rejected(make_demo):
    c = make_demo(demo_nemotron="live")
    bad = {**TUTTLE_CHOICE, "selected_facility_id": "lane-avenue-garage", "reason_codes": ["CONFIRMED_AVAILABILITY", "SHORTER_WALK", "LIGHTER_TRAFFIC", "LOWER_OCCUPANCY", "SHORTER_DISTANCE"], "uncertainty_codes": ["TRAFFIC_UNKNOWN"]}
    c.app.state.nemotron = NemotronClient(api_key=FAKE_KEY, transport=nemotron(bad))
    frame(c, 1)
    body = c.post("/api/v1/demo/recommendation").json()
    assert body["result"]["provenance"]["fallback_reason"] == "ungrounded_provider_response"
    assert (body["presentation"]["source"], body["presentation"]["facility_id"]) == ("fallback", "tuttle-garage")


# 7. No secrets exposed --------------------------------------------------------------------

def test_no_key_in_any_demo_response(make_demo, caplog):
    c = make_demo(demo_nemotron="live")
    c.app.state.nemotron = NemotronClient(api_key=FAKE_KEY, transport=nemotron(TUTTLE_CHOICE))
    frame(c, 1)
    texts = [
        c.get("/api/v1/demo/status").text, c.get("/api/v1/demo/scenario").text,
        c.post("/api/v1/demo/recommendation").text, c.post("/api/v1/demo/reset").text, c.get("/api/v1/health").text,
    ]
    for t in texts + [caplog.text]:
        assert FAKE_KEY not in t and "nb-test-key" not in t


def test_scripts_never_print_or_store_the_key():
    for name in ("start.mjs", "check.mjs", "reset.mjs", "stop.mjs", "lib.mjs"):
        src = (ROOT / "scripts/demo" / name).read_text()
        for line in src.splitlines():
            if "NEBIUS_API_KEY" in line:
                assert "console." not in line and "writeFile" not in line, f"{name}: {line.strip()}"
    start = (ROOT / "scripts/demo/start.mjs").read_text()
    assert "const { NEBIUS_API_KEY, ...envWithoutKey } = process.env;" in start  # sim and web never get it
    assert "...(live ? { NEBIUS_API_KEY } : {})" in start  # the API only, and only in live mode


# 8–9. Exact result shown, and grounded --------------------------------------------------

def test_exact_driver_facing_result(make_demo):
    c = make_demo()
    frame(c, 1)
    p = c.post("/api/v1/demo/recommendation").json()["presentation"]
    assert {
        "recommended": True, "garage": "Tuttle Garage", "level": "Level 2", "space_id": "B12", "walking_minutes": 4,
        "destination": "Dreese Laboratories", "class_time": "10:20 AM", "headline": "Park at Tuttle Garage",
        "availability_source": "demo-fixture", "availability_simulated": True,
    }.items() <= p.items()
    assert p["explanation"] == (
        "Tuttle Garage is your best option for Dreese Labs because it gives you the shortest walk "
        "while meeting the demo's confirmed parking-availability criteria."
    )
    assert [g["chosen"] for g in p["comparison"]] == [True, False, False]


def test_recommendation_is_grounded_in_fixture_and_live_camera(make_demo):
    c = make_demo()
    assert c.post("/api/v1/demo/recommendation").status_code == 409  # no camera evidence, no recommendation
    frame(c, 1)
    body = c.post("/api/v1/demo/recommendation").json()
    s = load_scenario()
    facts = body["facts"]
    assert facts["destination"] == s.next_class.destination
    for f, cand in zip(facts["facilities"], s.candidates, strict=True):
        assert (f["facility_id"], f["available_spaces"], f["total_spaces"], f["walking_minutes"], f["traffic"]) == (
            cand.facility_id, cand.demo_available_spaces, cand.total_spaces, cand.walking_minutes, cand.traffic)
        assert f["is_simulated"] is True
        # The snapshot is only as fresh as the live camera evidence.
        assert f["observed_at"] == body["camera"]["observed_at"]
    # The camera's own UNCERTAIN bays never become availability.
    assert body["camera"]["open"] == [] and len(body["camera"]["uncertain"]) == 8
    assert "truth" not in json.dumps(facts).lower()


def test_stale_camera_evidence_blocks_the_recommendation(make_demo):
    c = make_demo(stale_after_ms=1)
    frame(c, 1)
    import time
    time.sleep(0.05)
    assert c.post("/api/v1/demo/recommendation").status_code == 409


# 10. Startup health check -------------------------------------------------------------

def test_check_script_fails_cleanly_when_nothing_is_running():
    if os.environ.get("PARKRIGHT_DEMO_RUNNING"):
        pytest.skip("a demo is running on the standard ports")
    r = subprocess.run(["node", "scripts/demo/check.mjs"], cwd=ROOT, capture_output=True, text=True, timeout=60,
                       env={**os.environ, "NEBIUS_API_KEY": ""})
    if "[PASS] API" in r.stdout:
        pytest.skip("a demo is running on the standard ports")
    assert r.returncode == 1
    assert "[FAIL] API" in r.stdout and "NOT READY" in r.stdout


def test_start_script_refuses_live_mode_without_a_key():
    env = {k: v for k, v in os.environ.items() if k != "NEBIUS_API_KEY"}
    r = subprocess.run(["node", "scripts/demo/start.mjs", "--live"], cwd=ROOT, capture_output=True, text=True, timeout=60, env=env)
    assert r.returncode == 1
    assert "Live mode needs NEBIUS_API_KEY" in r.stderr
