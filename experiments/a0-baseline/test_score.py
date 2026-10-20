import importlib.util
from pathlib import Path

# Load the sibling script by path: works under the repo's --import-mode=importlib.
_spec = importlib.util.spec_from_file_location("a0_score", Path(__file__).with_name("score.py"))
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
score = _module.score


def test_false_open_missing_and_exact_frame_join():
    data = {
        "predictions": [
            {
                "camera_id": "cam",
                "session_id": "run",
                "frame_seq": 1,
                "space_id": "A1",
                "state": "OPEN",
            },
            {
                "camera_id": "cam",
                "session_id": "other",
                "frame_seq": 1,
                "space_id": "A2",
                "state": "OPEN",
            },
        ],
        "ground_truth": [
            {
                "camera_id": "cam",
                "session_id": "run",
                "seq": 1,
                "spaces": [
                    {"space_id": "A1", "truth": "occupied"},
                    {"space_id": "A2", "truth": "empty"},
                ],
            }
        ],
    }
    result = score(data)
    assert result["false_open_count"] == 1
    assert result["open_precision"] == 0
    assert result["accuracy"] == 0
    assert result["missing_predictions"] == 1
    assert result["unmatched_predictions"] == 1
    assert result["uncertain_rate"] == 0.5


def test_empty_set_is_undefined_not_perfect():
    result = score({"predictions": [], "ground_truth": []})
    assert result["accuracy"] is None
    assert result["open_precision"] is None
