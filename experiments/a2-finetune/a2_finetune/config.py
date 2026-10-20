from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class ExperimentConfig:
    schema: str = "parkright-a2-finetune-config-v1"
    seed: int = 20261019
    architecture: str = "fasterrcnn_resnet50_fpn_v2"
    weights: str = "FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1"
    num_classes: int = 3
    class_mapping: tuple[tuple[str, int], ...] = (
        ("sedan", 1),
        ("suv", 1),
        ("hatchback", 1),
        ("van", 1),
        ("pickup", 2),
    )
    label_names: tuple[str, ...] = ("background", "car", "truck")
    target_box: str = "bbox_visible"
    min_size: int = 384
    max_size: int = 684
    batch_size: int = 1
    epochs: int = 4
    workers: int = 0
    optimizer: str = "SGD"
    learning_rate: float = 0.0025
    momentum: float = 0.9
    weight_decay: float = 0.0005
    scheduler: str = "StepLR(step_size=3,gamma=0.1)"
    trainable_backbone_layers: int = 0
    horizontal_flip_probability: float = 0.5
    brightness: float = 0.12
    contrast: float = 0.12
    blur_probability: float = 0.08
    jpeg_probability: float = 0.12
    jpeg_quality_min: int = 78
    jpeg_quality_max: int = 95
    evaluation_confidence: float = 0.65
    evaluation_iou: float = 0.5
    occupied_coverage: float = 0.45
    ambiguity_confidence: float = 0.05
    ambiguity_coverage: float = 0.02
    allow_open: bool = False
    checkpoint_metric: str = "vehicle_map_50_95"

    def mapping(self) -> dict[str, int]:
        return dict(self.class_mapping)

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["class_mapping"] = dict(self.class_mapping)
        return payload

    def canonical_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_json().encode()).hexdigest()

    def write(self, path: Path) -> None:
        path.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n")


def load_config(path: Path) -> ExperimentConfig:
    data = json.loads(path.read_text())
    if data.pop("schema", None) != "parkright-a2-finetune-config-v1":
        raise ValueError("unsupported experiment config schema")
    mapping = data.pop("class_mapping")
    data["class_mapping"] = tuple((key, int(value)) for key, value in mapping.items())
    data["label_names"] = tuple(data["label_names"])
    return ExperimentConfig(**data)

