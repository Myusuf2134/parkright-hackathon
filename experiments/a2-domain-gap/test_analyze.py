import base64
import importlib.util
import io
import json
from pathlib import Path
import sys

from PIL import Image

SPEC = importlib.util.spec_from_file_location("a2_analyze", Path(__file__).with_name("analyze.py"))
assert SPEC and SPEC.loader
analyze = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = analyze
SPEC.loader.exec_module(analyze)
controlled_variants = analyze.controlled_variants
histogram = analyze.histogram
image_metrics = analyze.image_metrics
load_samples = analyze.load_samples


def jpeg_base64(size=(16, 9)):
    buffer = io.BytesIO()
    Image.new("RGB", size, (30, 60, 90)).save(buffer, "JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


def test_loads_a1_bundle_without_using_predictions_as_truth(tmp_path):
    path = tmp_path / "dataset.json"
    path.write_text(
        json.dumps(
            {
                "schema": "parkright-evaluation-v1",
                "records": [
                    {
                        "jpeg_base64": jpeg_base64(),
                        "metadata": {"session_id": "s", "seq": 4},
                        "scenario": {"seed": 7, "preset": "night"},
                        "ground_truth": {
                            "spaces": [
                                {"space_id": "A1", "truth": "occupied"},
                                {"space_id": "A2", "truth": "empty"},
                            ]
                        },
                        "predictions": [{"space_id": "A2", "state": "OCCUPIED"}],
                    }
                ],
            }
        )
    )
    samples, schema = load_samples(path)
    assert schema == "parkright-evaluation-v1"
    assert samples[0].frame_id == "s:4"
    assert samples[0].occupied_spaces == ("A1",)
    assert samples[0].image.size == (16, 9)


def test_canonical_manifest_paths_are_relative_to_manifest(tmp_path):
    image = tmp_path / "frame.jpg"
    image.write_bytes(base64.b64decode(jpeg_base64()))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema": "parkright-a2-dataset-v1",
                "frames": [
                    {
                        "frame_id": "f1",
                        "image_path": "frame.jpg",
                        "objects": [
                            {"class": "car", "space_id": "B2", "bbox_xyxy": [1, 1, 5, 5]}
                        ],
                    }
                ],
            }
        )
    )
    samples, _ = load_samples(manifest)
    assert samples[0].occupied_spaces == ("B2",)
    assert samples[0].objects[0]["bbox_xyxy"] == [1, 1, 5, 5]


def test_preprocessing_variants_preserve_rgb_and_letterbox_aspect():
    image = Image.new("RGB", (160, 90), "white")
    variants = controlled_variants(image)
    assert variants["baseline"].size == (160, 90)
    assert variants["letterbox_gray"].size == (160, 160)
    assert variants["pre_resize_bicubic"].size == (300, 300)
    assert all(value.mode == "RGB" for value in variants.values())


def test_metrics_and_histogram_boundaries():
    metrics = image_metrics(Image.new("RGB", (4, 3), (10, 20, 30)))
    assert metrics["source_dtype"] == "uint8"
    assert metrics["has_alpha"] is False
    counts = histogram([0.01, 0.019, 0.02, 0.649, 0.65])
    assert sum(bucket["count"] for bucket in counts) == 5
    assert counts[1]["count"] == 2
    assert counts[-1]["count"] == 1
