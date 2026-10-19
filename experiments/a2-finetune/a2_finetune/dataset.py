from __future__ import annotations

import hashlib
import io
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .config import ExperimentConfig


ALLOWED_SPLITS = {"train", "validation", "test"}


@dataclass(frozen=True)
class SampleRecord:
    root: Path
    sample_id: str
    split: str
    subset: str
    family: str
    kind: str
    seed: int
    environment: str
    image_path: Path
    label_path: Path
    width: int
    height: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _test_unlock_valid(path: Path | None, manifest_sha256: str) -> bool:
    if path is None or not path.is_file():
        return False
    payload = json.loads(path.read_text())
    required = {
        "schema": "parkright-a2-frozen-v1",
        "status": "frozen-before-test",
        "dataset_manifest_sha256": manifest_sha256,
    }
    return all(payload.get(key) == value for key, value in required.items())


def iter_manifest(
    manifest: Path,
    split: str,
    *,
    test_unlock: Path | None = None,
) -> Iterator[dict[str, Any]]:
    if split not in ALLOWED_SPLITS:
        raise ValueError(f"unsupported split: {split}")
    digest = sha256_file(manifest)
    if split == "test" and not _test_unlock_valid(test_unlock, digest):
        raise PermissionError("TEST is sealed; provide a matching frozen configuration")
    with manifest.open() as handle:
        for line_number, line in enumerate(handle, 1):
            record = json.loads(line)
            if record.get("split") == split:
                record["_manifest_line"] = line_number
                yield record


def load_records(
    manifest: Path,
    split: str,
    *,
    test_unlock: Path | None = None,
    validate_files: bool = True,
) -> list[SampleRecord]:
    root = manifest.parent
    records: list[SampleRecord] = []
    seen: set[str] = set()
    for raw in iter_manifest(manifest, split, test_unlock=test_unlock):
        sample_id = raw["sample_id"]
        if sample_id in seen:
            raise ValueError(f"duplicate sample_id: {sample_id}")
        seen.add(sample_id)
        image = raw["image"]
        image_path = root / image["path"]
        label_path = root / raw["labels_path"]
        if image["width"] != 1280 or image["height"] != 720:
            raise ValueError(f"unexpected dimensions for {sample_id}")
        if validate_files and (not image_path.is_file() or not label_path.is_file()):
            raise FileNotFoundError(f"missing data for {sample_id}")
        records.append(
            SampleRecord(
                root=root,
                sample_id=sample_id,
                split=split,
                subset=raw["subset"],
                family=raw["family"],
                kind=raw["kind"],
                seed=int(raw["seed"]),
                environment=raw["environment"]["preset_id"],
                image_path=image_path,
                label_path=label_path,
                width=int(image["width"]),
                height=int(image["height"]),
            )
        )
    return records


def load_label(record: SampleRecord, mapping: dict[str, int]) -> dict[str, Any]:
    label = json.loads(record.label_path.read_text())
    if label.get("sample_id") != record.sample_id:
        raise ValueError(f"label/sample mismatch: {record.sample_id}")
    if label["image"]["width"] != record.width or label["image"]["height"] != record.height:
        raise ValueError(f"label dimensions mismatch: {record.sample_id}")
    boxes, labels, original, space_ids = [], [], [], []
    for vehicle in label["vehicles"]:
        category = vehicle["class"]
        if category not in mapping:
            raise ValueError(f"unknown vehicle class: {category}")
        box = vehicle.get("bbox_visible")
        if box is None or len(box) != 4:
            raise ValueError(f"missing bbox_visible: {record.sample_id}")
        x1, y1, x2, y2 = map(float, box)
        if not (0 <= x1 < x2 <= record.width and 0 <= y1 < y2 <= record.height):
            raise ValueError(f"invalid bbox_visible: {record.sample_id}")
        boxes.append([x1, y1, x2, y2])
        labels.append(mapping[category])
        original.append(category)
        space_ids.append(vehicle.get("space_id"))
    return {
        "boxes": boxes,
        "labels": labels,
        "original_classes": original,
        "space_ids": space_ids,
        "spaces": label["spaces"],
    }


class ParkRightDetectionDataset:
    def __init__(self, records: list[SampleRecord], config: ExperimentConfig, training: bool):
        self.records = records
        self.config = config
        self.training = training
        self.epoch = 0

    def __len__(self) -> int:
        return len(self.records)

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def __getitem__(self, index: int):
        import torch
        from torchvision.transforms.functional import pil_to_tensor

        record = self.records[index]
        target = load_label(record, self.config.mapping())
        with Image.open(record.image_path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        if image.size != (record.width, record.height):
            raise ValueError(f"decoded dimensions mismatch: {record.sample_id}")
        boxes = [list(box) for box in target["boxes"]]
        if self.training:
            rng = random.Random(self.config.seed + self.epoch * 1_000_003 + index)
            if rng.random() < self.config.horizontal_flip_probability:
                image = ImageOps.mirror(image)
                boxes = [[record.width - x2, y1, record.width - x1, y2] for x1, y1, x2, y2 in boxes]
            brightness = rng.uniform(1 - self.config.brightness, 1 + self.config.brightness)
            contrast = rng.uniform(1 - self.config.contrast, 1 + self.config.contrast)
            image = ImageEnhance.Brightness(image).enhance(brightness)
            image = ImageEnhance.Contrast(image).enhance(contrast)
            if rng.random() < self.config.blur_probability:
                image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 0.8)))
            if rng.random() < self.config.jpeg_probability:
                buffer = io.BytesIO()
                image.save(buffer, "JPEG", quality=rng.randint(self.config.jpeg_quality_min, self.config.jpeg_quality_max))
                buffer.seek(0)
                with Image.open(buffer) as recompressed:
                    image = recompressed.convert("RGB")
        tensor = pil_to_tensor(image).float().div(255)
        box_tensor = torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4)
        label_tensor = torch.tensor(target["labels"], dtype=torch.int64)
        areas = ((box_tensor[:, 2] - box_tensor[:, 0]) * (box_tensor[:, 3] - box_tensor[:, 1]))
        return tensor, {
            "boxes": box_tensor,
            "labels": label_tensor,
            "image_id": torch.tensor([index], dtype=torch.int64),
            "area": areas,
            "iscrowd": torch.zeros(len(boxes), dtype=torch.int64),
        }


def collate_detection(batch):
    return tuple(zip(*batch, strict=True))

