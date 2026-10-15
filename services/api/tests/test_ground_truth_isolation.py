"""Simulator ground truth must never reach perception or parking state. These tests make a leak fail loudly."""

import ast
import json
import subprocess
import sys
from dataclasses import fields
from pathlib import Path

import pytest

from parkright_api.config import Settings
from parkright_api.main import create_app
from parkright_contracts import FrameMetadata

from .conftest import CAMERA, SPACES, meta, occupancy, send

TRUTH = {
    "session_id": "run-1", "camera_id": CAMERA, "seq": 0, "sim_time_ms": 0, "environment_preset": "clear_day",
    "spaces": [{"space_id": s, "truth": "empty"} for s in SPACES],
}


def test_frame_with_a_ground_truth_part_is_rejected(client, provider):
    res = send(client, meta(0), extra={"ground_truth": json.dumps(TRUTH)})
    assert (res.status_code, res.json()["error"]["code"]) == (400, "unexpected_part")
    assert provider.calls == []


@pytest.mark.parametrize("smuggled", [{"spaces": TRUTH["spaces"]}, {"occupancy": {"A1": "OPEN"}}, {"ground_truth": TRUTH}, {"vehicles": [[0.1, 0.2]]}])
def test_ground_truth_smuggled_in_metadata_is_rejected(client, provider, smuggled):
    res = send(client, meta(0) | smuggled)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_metadata")
    assert provider.calls == []


def test_provider_receives_only_metadata_and_pixels(client, provider):
    assert send(client, meta(0)).status_code == 202
    (frame, view), = provider.calls
    assert [f.name for f in fields(frame)] == ["metadata", "jpeg"]
    assert set(type(frame.metadata).model_fields) == {"session_id", "camera_id", "seq", "sim_time_ms", "captured_at"}
    assert isinstance(frame.metadata, FrameMetadata) and frame.jpeg.startswith(b"\xff\xd8\xff")
    assert [s.space_id for s in view.spaces] == SPACES


def test_recording_ground_truth_changes_nothing_in_production_state(client, provider):
    before = occupancy(client)
    assert client.post("/api/v1/evaluation/ground-truth", json=TRUTH).status_code == 202
    after = occupancy(client)
    assert after["spaces"] == before["spaces"] and after["counts"]["open"] == 0
    assert provider.calls == []
    listed = client.get(f"/api/v1/evaluation/ground-truth?camera_id={CAMERA}&session_id=run-1").json()
    assert listed[0]["spaces"][0] == {"space_id": "A1", "truth": "empty"}


def test_ground_truth_in_occupancy_vocabulary_is_rejected(client):
    bad = TRUTH | {"spaces": [{"space_id": "A1", "truth": "OPEN"}]}
    assert client.post("/api/v1/evaluation/ground-truth", json=bad).status_code == 400


def test_evaluation_is_absent_in_production():
    app = create_app(Settings(env="production", ingest_token="t" * 32, _env_file=None))
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        res = c.post("/api/v1/evaluation/ground-truth", json=TRUTH, headers={"authorization": "Bearer " + "t" * 32})
        assert res.status_code == 404


def test_production_path_never_loads_the_evaluation_package():
    code = (
        "import sys\n"
        "from parkright_api.config import Settings\n"
        "from parkright_api.main import create_app\n"
        "create_app(Settings(env='production', ingest_token='t'*32, _env_file=None))\n"
        "assert 'parkright_evaluation' not in sys.modules, 'evaluation was imported'\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


API = Path(__file__).resolve().parents[1] / "src" / "parkright_api"
PRODUCTION_PATH = ["routes/frames.py", "routes/facilities.py", "routes/realtime.py", "state.py", "stream_tracker.py", "realtime.py", "deps.py", "upload_limit.py"]


def _imports(tree: ast.AST) -> list[str]:
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(f"{'.' * node.level}{node.module or ''}")
    return names


@pytest.mark.parametrize("path", PRODUCTION_PATH)
def test_production_modules_do_not_import_evaluation(path):
    source = (API / path).read_text()
    assert not any("evaluation" in n for n in _imports(ast.parse(source))), path
    assert "GroundTruth" not in source, path


def test_main_imports_evaluation_only_lazily():
    tree = ast.parse((API / "main.py").read_text())
    top_level = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    assert not any("evaluation" in n for n in _imports(ast.Module(body=top_level, type_ignores=[])))
