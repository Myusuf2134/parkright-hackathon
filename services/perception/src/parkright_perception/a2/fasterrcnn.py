"""A2 torchvision Faster R-CNN ResNet-50-FPN-v2, fine-tuned (experiments/a2-finetune).

Explicit local checkpoint, verified by SHA-256 before torch.load; no downloads (the
architecture is built without pretrained weights and the checkpoint supplies all of
them). Loading uses weights_only=True and map_location=cpu. Neither metadata nor
ROIs reach the model: it sees the full frame only.
"""

import hashlib
from importlib.metadata import version
from pathlib import Path
from typing import Any

from PIL import Image

from ..a0.detector import Detection, DetectionResult

CHECKPOINT_SHA256 = "43452092f0597922badc038c618dd5c76afc27d98be21688a2878f28b1c24985"
PROVIDER_NAME = "a2-fasterrcnn"
# Training mapping (experiments/a2-finetune/config.json): sedan/suv/hatchback/van → car,
# pickup → truck. Index 0 is background.
LABELS = {1: "car", 2: "truck"}
# Model geometry and score floor used for training and the held-out evaluation.
MIN_SIZE, MAX_SIZE, SCORE_FLOOR = 384, 684, 0.05


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FasterRCNNA2:
    provider_name = PROVIDER_NAME

    def __init__(self, checkpoint: Path, device: str = "cpu", expected_sha256: str = CHECKPOINT_SHA256):
        if device not in ("cpu", "cuda"):
            raise ValueError("A2 supports explicit cpu or cuda devices")
        if not checkpoint.is_file():
            raise FileNotFoundError(f"A2 checkpoint not found: {checkpoint}")
        digest = sha256_file(checkpoint)
        if digest != expected_sha256:
            raise ValueError("checkpoint does not match the frozen A2 artifact")
        self.checkpoint, self.device, self.sha256 = checkpoint, device, digest
        self.identity = f"a2-fasterrcnn-resnet50-fpn-v2:{digest}:torch-{version('torch')}-{device}"
        self._model: Any = None

    def _load(self):
        import torch
        from torchvision.models.detection import fasterrcnn_resnet50_fpn_v2

        if self.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA explicitly requested but unavailable")
        model = fasterrcnn_resnet50_fpn_v2(
            weights=None, weights_backbone=None, num_classes=len(LABELS) + 1,
            min_size=MIN_SIZE, max_size=MAX_SIZE, box_score_thresh=SCORE_FLOOR,
        )
        payload = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
        model.load_state_dict(payload["model"], strict=True)
        self._model = model.eval().to(self.device)

    def detect(self, image: Image.Image) -> DetectionResult:
        import torch
        from torchvision.transforms.functional import pil_to_tensor

        if self._model is None:
            self._load()
        w, h = image.size
        tensor = pil_to_tensor(image.convert("RGB")).float().div(255).to(self.device)
        with torch.inference_mode():
            output = self._model([tensor])[0]
        detections = []
        for (x0, y0, x1, y1), label, score in zip(
            output["boxes"].cpu().tolist(), output["labels"].cpu().tolist(), output["scores"].cpu().tolist(), strict=True,
        ):
            # Unknown class ids never establish OCCUPIED, but still count as obstruction evidence.
            box = (min(max(x0 / w, 0.0), 1.0), min(max(y0 / h, 0.0), 1.0), min(max(x1 / w, 0.0), 1.0), min(max(y1 / h, 0.0), 1.0))
            if box[0] < box[2] and box[1] < box[3]:
                detections.append(Detection(LABELS.get(int(label), "obstruction"), float(score), box))
        # No background anchors: OPEN can never be established from A2 output.
        return DetectionResult(tuple(detections))
