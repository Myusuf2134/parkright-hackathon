import json

import pytest
from PIL import Image

from a2_finetune.config import ExperimentConfig
from a2_finetune.dataset import ParkRightDetectionDataset, load_label, load_records, sha256_file


def make_dataset(tmp_path):
    (tmp_path / "images/train").mkdir(parents=True)
    (tmp_path / "images/test").mkdir(parents=True)
    (tmp_path / "labels/train").mkdir(parents=True)
    (tmp_path / "labels/test").mkdir(parents=True)
    records = []
    for split in ("train", "test"):
        Image.new("RGB", (1280, 720), "white").save(tmp_path / f"images/{split}/one.jpg")
        label = {
            "sample_id": f"{split}-one",
            "image": {"width": 1280, "height": 720},
            "vehicles": [{"class": "pickup", "bbox_visible": [10, 20, 50, 80], "bbox_amodal": [0, 0, 100, 100], "space_id": "A1"}],
            "spaces": [{"space_id": "A1", "truth": "occupied", "polygon_px": [[0, 0], [100, 0], [100, 100], [0, 100]]}],
        }
        (tmp_path / f"labels/{split}/one.json").write_text(json.dumps(label))
        records.append({
            "sample_id": f"{split}-one", "split": split, "subset": "standard", "family": "settled", "kind": "settled", "seed": 1 if split == "train" else 2,
            "environment": {"preset_id": "clear_day"},
            "image": {"path": f"images/{split}/one.jpg", "width": 1280, "height": 720},
            "labels_path": f"labels/{split}/one.json",
        })
    manifest = tmp_path / "manifest.jsonl"
    manifest.write_text("".join(json.dumps(value) + "\n" for value in records))
    return manifest


def test_loader_uses_visible_box_and_class_mapping(tmp_path):
    manifest = make_dataset(tmp_path)
    records = load_records(manifest, "train")
    target = load_label(records[0], ExperimentConfig().mapping())
    assert target["boxes"] == [[10.0, 20.0, 50.0, 80.0]]
    assert target["labels"] == [2]
    image, tensor_target = ParkRightDetectionDataset(records, ExperimentConfig(horizontal_flip_probability=0), False)[0]
    assert tuple(image.shape) == (3, 720, 1280)
    assert tensor_target["boxes"].tolist() == [[10.0, 20.0, 50.0, 80.0]]


def test_test_split_requires_matching_freeze(tmp_path):
    manifest = make_dataset(tmp_path)
    with pytest.raises(PermissionError):
        load_records(manifest, "test")
    unlock = tmp_path / "frozen.json"
    unlock.write_text(json.dumps({"schema": "parkright-a2-frozen-v1", "status": "frozen-before-test", "dataset_manifest_sha256": sha256_file(manifest)}))
    assert len(load_records(manifest, "test", test_unlock=unlock)) == 1

