import asyncio
import ast
import math
from datetime import UTC, datetime
from pathlib import Path

import pytest

from parkright_contracts import FrameMetadata, ModelRef, OccupancyState
from parkright_perception import CameraView, Frame, PerceptionProvider, SpaceInference, WatchedSpace, create_provider, to_observations

META = FrameMetadata(session_id="run-1", camera_id="cam-01", seq=7, sim_time_ms=700, captured_at=datetime(2026, 10, 14, tzinfo=UTC))
FRAME = Frame(metadata=META, jpeg=b"\xff\xd8\xff\xd9")
VIEW = CameraView(camera_id="cam-01", spaces=tuple(WatchedSpace(space_id=s, polygon=None) for s in ["A1", "A2", "A3"]))
MODEL = ModelRef(provider="test", version="1")
O, X, U = OccupancyState.OPEN, OccupancyState.OCCUPIED, OccupancyState.UNCERTAIN


def states(raw):
    return [o.state for o in to_observations(FRAME, VIEW, MODEL, raw)]


def test_one_observation_per_watched_space_with_pipeline_provenance():
    obs = to_observations(FRAME, VIEW, MODEL, [SpaceInference("A1", O, 0.9), SpaceInference("A2", X, 0.8), SpaceInference("A3", X, 0.7)])
    assert [o.space_id for o in obs] == ["A1", "A2", "A3"]
    assert all(o.camera_id == "cam-01" and o.session_id == "run-1" and o.frame_seq == 7 and o.model == MODEL for o in obs)
    assert [o.state for o in obs] == [O, X, X]


def test_missing_duplicate_and_unwatched_spaces():
    raw = [SpaceInference("A1", O, 0.9), SpaceInference("A2", X, 0.9), SpaceInference("A2", O, 0.9), SpaceInference("Z9", X, 0.9)]
    assert states(raw) == [O, U, U]


@pytest.mark.parametrize("confidence", [math.nan, math.inf, -0.1, 1.5])
def test_invalid_confidence_is_uncertain(confidence):
    assert states([SpaceInference("A1", X, confidence), SpaceInference("A2", O, 0.9), SpaceInference("A3", O, 0.9)])[0] is U


def test_weak_open_and_unscored_occupied_are_uncertain():
    assert states([SpaceInference("A1", O, 0.2), SpaceInference("A2", O, None), SpaceInference("A3", X, None)]) == [U, U, U]


def test_uncertain_is_never_promoted():
    assert states([SpaceInference(s, U, 0.99) for s in ["A1", "A2", "A3"]]) == [U, U, U]


def test_default_provider_claims_nothing():
    provider = create_provider("none")
    assert isinstance(provider, PerceptionProvider)
    raw = asyncio.run(provider.infer(FRAME, VIEW))
    obs = to_observations(FRAME, VIEW, provider.model, raw)
    assert all(o.state is U and o.confidence is None for o in obs)


def test_unknown_provider_is_an_error():
    with pytest.raises(ValueError, match="unknown perception provider"):
        create_provider("magic")


def test_frame_carries_only_metadata_and_pixels():
    assert Frame.__slots__ == ("metadata", "jpeg")
    assert set(FrameMetadata.model_fields) == {"session_id", "camera_id", "seq", "sim_time_ms", "captured_at"}


def test_package_never_imports_evaluation():
    src = Path(__file__).resolve().parents[1] / "src"
    for path in src.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            assert not any("evaluation" in n for n in names), f"{path} imports evaluation"
