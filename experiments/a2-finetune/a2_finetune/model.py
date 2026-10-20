from __future__ import annotations

from .config import ExperimentConfig


def build_model(config: ExperimentConfig, *, pretrained: bool = True):
    from torchvision.models.detection import (
        FasterRCNN_ResNet50_FPN_V2_Weights,
        fasterrcnn_resnet50_fpn_v2,
    )
    from torchvision.models.detection.faster_rcnn import FastRCNNPredictor

    weights = FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1 if pretrained else None
    model = fasterrcnn_resnet50_fpn_v2(
        weights=weights,
        min_size=config.min_size,
        max_size=config.max_size,
        trainable_backbone_layers=config.trainable_backbone_layers,
    )
    features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(features, config.num_classes)
    return model


def load_checkpoint(model, path, device: str = "cpu") -> dict:
    import torch

    payload = torch.load(path, map_location=device, weights_only=True)
    model.load_state_dict(payload["model"], strict=True)
    return payload

