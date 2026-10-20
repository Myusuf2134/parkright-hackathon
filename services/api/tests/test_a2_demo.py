"""Demo path: calibrated frame → A2 detector → occupancy → state-grounded recommendation → Nemotron/fallback."""

import ast
import io
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from parkright_api.config import Settings
from parkright_api.main import create_app
from parkright_api.recommendations.client import MODEL, NemotronClient
from parkright_api.recommendations.models import ParkingOption
from parkright_contracts import ModelRef, OccupancyObservation, OccupancyState
from parkright_perception.a0.config import A0Config
from parkright_perception.a0.provider import A0Provider
from parkright_perception.a2.fasterrcnn import FasterRCNNA2, sha256_file
from parkright_perception.a2.provider import DEFAULT_CHECKPOINT

ROOT = Path(__file__).resolve().parents[3]
CAL_FILE = ROOT / "packages/shared/calibration/cam-01.json"
CAL = json.loads(CAL_FILE.read_text())
DATASET = Path.home() / ".cache/parkright/datasets/a2-sim-v1-b569da957c"
TOKEN = "demo-test-token"
AUTH = {"authorization": f"Bearer {TOKEN}"}
RECOMMEND = "/api/v1/facilities/garage-01/recommendation"
SPACES = [f"{r}{i}" for r in "AB" for i in range(1, 7)]
FACT_FIELDS = set(ParkingOption.model_fields)


def bounds(space_id):
    xs = [p["x"] * 1280 for p in CAL["polygons"][space_id]]
    ys = [p["y"] * 720 for p in CAL["polygons"][space_id]]
    return [min(xs), min(ys), max(xs), max(ys)]


class FakeNetwork:
    def __init__(self, rows):
        self.rows = rows

    def __call__(self, images):
        import torch

        return [{
            "boxes": torch.tensor([bounds(s) for s, _ in self.rows], dtype=torch.float32).reshape(-1, 4),
            "labels": torch.tensor([label for _, label in self.rows], dtype=torch.int64),
            "scores": torch.full((len(self.rows),), 0.95),
        }]


def a2_provider(tmp_path, rows):
    artifact = tmp_path / "fake.pt"
    artifact.write_bytes(b"fake")
    detector = FasterRCNNA2(artifact, expected_sha256=sha256_file(artifact))
    detector._model = FakeNetwork(rows)
    return A0Provider(detector, A0Config())


def scene_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.effect_noise((1280, 720), 40).convert("RGB").point(lambda v: 60 + v // 2).save(buf, "JPEG")
    return buf.getvalue()


def app_client(perception=None, **settings) -> TestClient:
    return TestClient(create_app(Settings(
        env="test", _env_file=None, calibration_file=CAL_FILE, facility_fixtures=[CAL_FILE.with_name("facility.json")],
        ingest_token=TOKEN, **settings,
    ), perception=perception))


def wait_ready(client, timeout=60):
    deadline = time.monotonic() + timeout
    while not client.get("/api/v1/health").json()["inference"].get("inference_ready"):
        assert time.monotonic() < deadline, "detector never became ready"
        time.sleep(0.1)


def send_frame(client, jpeg: bytes, seq=0):
    session = "demo"
    assert client.post("/api/v1/cameras/cam-01/calibration", headers=AUTH, json={"session_id": session, "version": CAL["version"], "pose": CAL["pose"]}).status_code == 200
    meta = {"session_id": session, "camera_id": "cam-01", "seq": seq, "sim_time_ms": 0, "captured_at": datetime.now(UTC).isoformat()}
    return client.post("/api/v1/cameras/cam-01/frames", headers=AUTH, data={"metadata": json.dumps(meta)}, files={"image": ("f.jpg", jpeg, "image/jpeg")})


def install(client, handler):
    calls = []

    def recording(request):
        calls.append(json.loads(request.content))
        return handler(request)

    client.app.state.nemotron = NemotronClient(api_key="stub-key-not-secret", transport=httpx.MockTransport(recording))
    return calls


def never_called(request):
    raise AssertionError("Nemotron must not be called")


def completion(decision):
    return httpx.Response(200, json={"id": "r", "model": MODEL, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(decision)}}]})


def with_open(client, open_spaces, occupied=()):
    """Stand-in for a future OPEN-capable detector; unreachable with today's policy (allow_open=false)."""
    facility = client.app.state.registry.get("garage-01")
    model = ModelRef(provider="test-open-capable", version="1")
    now = datetime.now(UTC)
    state = {s: OccupancyState.OPEN for s in open_spaces} | {s: OccupancyState.OCCUPIED for s in occupied}
    facility.apply([
        OccupancyObservation(space_id=s, camera_id="cam-01", session_id="demo", frame_seq=1, sim_time_ms=0, captured_at=now, state=st, confidence=0.9, model=model)
        for s, st in state.items()
    ], now)


# K. The complete local flow with A2 (network faked, decoder + mapper + API real).
def test_a2_frame_to_state_grounded_recommendation(tmp_path):
    with app_client(a2_provider(tmp_path, [("A1", 1), ("A3", 1), ("B2", 2), ("B5", 1)])) as client:
        calls = install(client, never_called)
        wait_ready(client)
        assert client.post(RECOMMEND).json()["error"]["code"] == "no_observation"
        frame = send_frame(client, scene_jpeg())
        assert frame.status_code == 202, frame.text
        assert frame.json()["model"]["provider"] == "a2-fasterrcnn"
        states = {o["space_id"]: o["state"] for o in frame.json()["observations"]}
        assert {s for s, v in states.items() if v == "OCCUPIED"} == {"A1", "A3", "B2", "B5"}
        assert "OPEN" not in states.values()
        reply = client.post(RECOMMEND)
        assert reply.status_code == 200
        facts, result = reply.json()["facts"], reply.json()["result"]
        f = facts["facilities"][0]
        assert set(f) == FACT_FIELDS and facts["destination"] is None
        assert f | {"observed_at": None} == {
            "facility_id": "garage-01", "name": "ParkRight Virtual Garage", "total_spaces": 12, "available_spaces": 0,
            "occupancy_percentage": None, "walking_minutes": None, "distance_m": None, "traffic": "unknown",
            "status": "unknown", "is_simulated": True, "observed_at": None,
        }
        # No confirmed availability → no Nemotron call, no fabricated OPEN.
        assert calls == []
        assert result["facility_id"] is None
        assert result["provenance"] | {"latency_ms": 0, "request_timestamp": None} == {
            "provider": "nebius-token-factory", "model": MODEL, "latency_ms": 0, "status": "fallback", "request_timestamp": None,
            "attempted": False, "fallback_reason": "no_confirmed_availability", "provider_response_id": None, "provider_reported_model": None,
        }
        # Observations are unchanged by asking for advice.
        assert {s["space_id"]: s["current_state"] for s in client.get("/api/v1/facilities/garage-01/spaces").json()["spaces"]} == states


@pytest.mark.skipif(not (DEFAULT_CHECKPOINT.is_file() and (DATASET / "manifest.jsonl").is_file()), reason="A2 checkpoint or dataset not present locally")
def test_real_a2_held_out_frame_through_api(monkeypatch):
    monkeypatch.delenv("PARKRIGHT_A2_CHECKPOINT", raising=False)
    with (DATASET / "manifest.jsonl").open() as manifest:
        record = next(r for r in map(json.loads, manifest) if r["split"] == "test" and r["family"] == "settled" and r["environment"]["preset_id"] == "clear_day")
    with app_client(perception_provider="a2") as client:
        calls = install(client, never_called)
        wait_ready(client, 120)
        frame = send_frame(client, (DATASET / record["image"]["path"]).read_bytes())
        assert frame.status_code == 202, frame.text
        got = {o["space_id"]: o["state"] for o in frame.json()["observations"]}
        truth = {s["space_id"]: s["truth"] for s in record["spaces"]}
        assert {s for s, v in got.items() if v == "OCCUPIED"} == {s for s, v in truth.items() if v == "occupied"}
        assert "OPEN" not in got.values()
        assert client.post(RECOMMEND).json()["result"]["provenance"]["fallback_reason"] == "no_confirmed_availability"
        assert calls == []


# F. Ground truth recorded for evaluation never changes recommendation facts.
def test_ground_truth_never_reaches_recommendation_facts(tmp_path):
    with app_client(a2_provider(tmp_path, [("A1", 1)]), evaluation_enabled=True) as client:
        install(client, never_called)
        wait_ready(client)
        assert send_frame(client, scene_jpeg()).status_code == 202
        before = client.post(RECOMMEND).json()["facts"]
        truth = {"session_id": "demo", "camera_id": "cam-01", "seq": 0, "sim_time_ms": 0, "environment_preset": "clear_day",
                 "spaces": [{"space_id": s, "truth": "empty"} for s in SPACES]}
        assert client.post("/api/v1/evaluation/ground-truth", json=truth, headers=AUTH).status_code == 202
        assert client.post(RECOMMEND).json()["facts"] == before
    api = ROOT / "services/api/src/parkright_api"
    for path in ("recommendations/facts.py", "recommendations/service.py", "recommendations/client.py", "routes/recommendations.py"):
        source = (api / path).read_text()
        imported = [n.module or "" for n in ast.walk(ast.parse(source)) if isinstance(n, ast.ImportFrom)]
        imported += [a.name for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Import) for a in n.names]
        assert not any("evaluation" in m for m in imported) and "GroundTruth" not in source, path


# G. Nemotron receives only structured parking facts built from state.
def test_nemotron_receives_only_structured_state_facts():
    with app_client() as client:
        decision = {"selected_facility_id": "garage-01", "recommendation_code": "RECOMMEND", "reason_codes": ["CONFIRMED_AVAILABILITY"],
                    "uncertainty_codes": ["WALKING_TIME_UNKNOWN", "DISTANCE_UNKNOWN", "OCCUPANCY_UNKNOWN", "TRAFFIC_UNKNOWN", "OPERATING_STATUS_UNKNOWN", "DESTINATION_UNSPECIFIED"]}
        calls = install(client, lambda request: completion(decision))
        with_open(client, ["A2", "A4"], occupied=["A1"])
        result = client.post(RECOMMEND).json()["result"]
        assert len(calls) == 1
        context = json.loads(calls[0]["messages"][1]["content"])
        assert set(context) == {"destination", "facilities"} and context["destination"] is None
        [sent] = context["facilities"]
        assert set(sent) == FACT_FIELDS | {"allowed_reason_codes", "required_uncertainty_codes"}
        assert sent["available_spaces"] == 2 and sent["total_spaces"] == 12 and sent["occupancy_percentage"] is None
        assert calls[0]["guided_json"]["properties"]["selected_facility_id"]["enum"] == ["garage-01"]
        assert result["provenance"]["status"] == "success" and result["facility_id"] == "garage-01"
        assert result["recommendation"] == "Simulation only — not a real parking recommendation. Consider ParkRight Virtual Garage: 2 of 12 spaces reported available."


# H. The selected facility must be one that was supplied.
def test_unsupplied_facility_selection_falls_back():
    with app_client() as client:
        install(client, lambda request: completion({"selected_facility_id": "garage-99", "recommendation_code": "RECOMMEND",
                                                   "reason_codes": ["CONFIRMED_AVAILABILITY"], "uncertainty_codes": []}))
        with_open(client, ["A2"])
        p = client.post(RECOMMEND).json()["result"]["provenance"]
        assert p["status"] == "fallback" and p["attempted"] and p["fallback_reason"] in ("ungrounded_provider_response", "invalid_structured_decision")


# I. Facts ParkRight does not measure become explicit uncertainties.
def test_missing_facts_produce_uncertainties():
    with app_client() as client:
        install(client, lambda request: httpx.Response(503))
        with_open(client, ["A2"], occupied=["A1"])
        result = client.post(RECOMMEND).json()["result"]
        assert result["uncertainties"] == [
            "Walking time is unknown.", "Distance is unknown.", "Occupancy percentage is unknown.", "Traffic is unknown.",
            "Facility operating status is unknown.", "Destination is unspecified.",
        ]
        # A fully resolved lot has a known occupancy percentage.
        with_open(client, ["A1", "A2"], occupied=[s for s in SPACES if s not in ("A1", "A2")])
        facts = client.post(RECOMMEND).json()["facts"]["facilities"][0]
        assert facts["occupancy_percentage"] == pytest.approx(83.33) and facts["available_spaces"] == 2


# J. Nebius failure → deterministic, explicitly labelled fallback.
@pytest.mark.parametrize("failure, reason", [
    (lambda request: (_ for _ in ()).throw(httpx.ConnectError("down")), "provider_unavailable"),
    (lambda request: httpx.Response(500), "provider_http_error"),
])
def test_nebius_failure_falls_back_deterministically(failure, reason):
    with app_client() as client:
        install(client, failure)
        with_open(client, ["A2", "B3"])
        results = [client.post(RECOMMEND).json()["result"] for _ in range(2)]
        for r in results:
            assert r["provenance"]["status"] == "fallback" and r["provenance"]["fallback_reason"] == reason and r["provenance"]["attempted"]
            assert r["facility_id"] == "garage-01" and "2 of 12 spaces reported available" in r["recommendation"]
        assert results[0]["recommendation"] == results[1]["recommendation"]


def test_missing_key_falls_back_without_calling(monkeypatch):
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    with app_client() as client:
        client.app.state.nemotron = NemotronClient()
        status = client.get("/api/v1/recommendations/status").json()
        assert status == {"provider": "nebius-token-factory", "model": MODEL, "configured": False, "advisory_only": True}
        with_open(client, ["A2"])
        p = client.post(RECOMMEND).json()["result"]["provenance"]
        assert p["fallback_reason"] == "missing_api_key" and not p["attempted"]


def test_status_never_returns_the_key():
    with app_client() as client:
        client.app.state.nemotron = NemotronClient(api_key="sk-should-never-appear")
        response = client.get("/api/v1/recommendations/status")
        assert response.json()["configured"] is True and "sk-should-never-appear" not in response.text


def test_unknown_facility_is_404():
    with app_client() as client:
        assert client.post("/api/v1/facilities/nowhere/recommendation").status_code == 404
