"""NVIDIA SSD300 COCO 20.06.0. CPU/CUDA; explicit local artifacts, no startup downloads.

Source checkout must be the pinned official NVIDIA revision. Checkpoint loading
uses weights_only=True and map_location=cpu. Neither metadata nor ROIs reach SSD.
"""

import hashlib
import importlib
import subprocess
import sys
import types
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from .config import A0Config
from .detector import BackgroundAnchor, Detection, DetectionResult

SOURCE_REVISION = "a6c678ef0323cdaae053e9eed34dce94488ad313"
WEIGHTS_URL = (
    "https://api.ngc.nvidia.com/v2/models/nvidia/ssd_pyt_ckpt_amp/"
    "versions/20.06.0/files/nvidia_ssdpyt_amp_200703.pt"
)


class NvidiaSSD:
    def __init__(
        self,
        source: Path,
        weights: Path,
        device: str = "cpu",
        config: A0Config | None = None,
    ):
        if device not in ("cpu", "cuda"):
            raise ValueError("A0 supports explicit cpu or cuda devices")
        revision = subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
        ).strip()
        if revision != SOURCE_REVISION:
            raise ValueError("NVIDIA source must match pinned revision")
        if subprocess.check_output(
            ["git", "-C", str(source), "status", "--porcelain"], text=True
        ).strip():
            raise ValueError("NVIDIA source must be clean")
        self.config = config or A0Config()
        self.weights = weights
        self.device = device
        digest = hashlib.sha256(weights.read_bytes()).hexdigest()
        if digest != "8167ab3781fde764796931c661629b166dd192eac81fcb846b0f4b474c8cc616":
            raise ValueError("checkpoint does not match NVIDIA 20.06.0 artifact")
        self.identity = f"nvidia-ssd300:20.06.0:{revision}:{digest}:torch-{version('torch')}-{device}"
        self.source = source
        self._model: Any = None

    def _load(self):
        import torch

        if self.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA explicitly requested but unavailable")
        sys.path.insert(0, str(self.source / "PyTorch/Detection/SSD"))
        # The pinned source constructs a pretrained ResNet in a default argument
        # at import time. Remove only that default; full SSD weights supply it.
        path = self.source / "PyTorch/Detection/SSD/ssd/model.py"
        source = path.read_text()
        old = "def __init__(self, backbone=ResNet('resnet50')):"
        if source.count(old) != 1:
            raise ValueError("unexpected NVIDIA model constructor")
        module = types.ModuleType("parkright_nvidia_ssd_model")
        exec(  # noqa: S102 - verified pinned NVIDIA source
            compile(
                source.replace(old, "def __init__(self, backbone):"), str(path), "exec"
            ),
            module.__dict__,
        )
        utils = importlib.import_module("ssd.utils")
        model = module.SSD300(backbone=module.ResNet(weights=None))
        checkpoint = torch.load(self.weights, map_location="cpu", weights_only=True)
        state = {
            k.replace("module.1.", "").replace("module.", ""): v
            for k, v in checkpoint["model"].items()
        }
        model.load_state_dict(state, strict=True)
        self._model = model.eval().to(self.device)
        self._encoder = utils.Encoder(utils.dboxes300_coco())
        self._anchors = utils.dboxes300_coco()(order="xywh")[:, :2].tolist()

    def detect(self, image: Image.Image) -> DetectionResult:
        import torch

        if self._model is None:
            self._load()
        # Full-frame resize, no center crop: preserves all calibrated parking ROIs.
        pixels = np.asarray(
            image.resize((300, 300), Image.Resampling.BILINEAR), dtype=np.float32
        )
        tensor = torch.from_numpy(
            (pixels / 255.0 * 2.0 - 1.0).transpose(2, 0, 1).copy()
        )
        with torch.inference_mode():
            loc, logits = self._model(tensor.unsqueeze(0).to(self.device))
            background = logits.softmax(dim=1)[0, 0].cpu().tolist()
            # Decode on CPU: this also synchronizes CUDA before timing completes.
            boxes, probabilities = self._encoder.scale_back_batch(
                loc.float().cpu(), logits.float().cpu()
            )
            # Class-wise NMS retains weak evidence; no top-20 truncation hiding cars.
            from torchvision.ops import nms

            detections = []
            for class_id in range(1, probabilities.shape[-1]):
                scores = probabilities[0, :, class_id]
                mask = scores >= self.config.detector_min_score
                candidate_boxes, candidate_scores = (
                    boxes[0, mask].clamp(0, 1),
                    scores[mask],
                )
                keep = nms(
                    candidate_boxes, candidate_scores, self.config.detector_nms_iou
                )
                # COCO contiguous IDs, not sparse category IDs: truck is 8, not 7.
                label = {3: "car", 6: "bus", 8: "truck"}.get(class_id, "obstruction")
                for index in keep:
                    detections.append(
                        Detection(
                            label,
                            float(candidate_scores[index]),
                            tuple(candidate_boxes[index].tolist()),
                        )
                    )
        return DetectionResult(
            tuple(detections),
            tuple(
                BackgroundAnchor(x, y, float(score))
                for (x, y), score in zip(self._anchors, background, strict=True)
            ),
        )
