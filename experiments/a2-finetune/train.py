#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import random
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from a2_finetune.config import load_config
from a2_finetune.dataset import ParkRightDetectionDataset, collate_detection, load_records, sha256_file
from a2_finetune.evaluation import evaluate, write_summary
from a2_finetune.model import build_model


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=HERE / "config.json")
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu",), default="cpu")
    return parser.parse_args()


def seed_everything(seed: int):
    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def git_commit() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=HERE, text=True).strip()


def main():
    import torch
    import torchvision
    from torch.utils.data import DataLoader

    args = parse_args()
    config = load_config(args.config)
    seed_everything(config.seed)
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    args.artifacts.mkdir(parents=True, exist_ok=True)
    train_records = load_records(args.manifest, "train")
    validation_records = load_records(args.manifest, "validation")
    train_dataset = ParkRightDetectionDataset(train_records, config, training=True)
    generator = torch.Generator().manual_seed(config.seed)
    loader = DataLoader(
        train_dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=config.workers,
        collate_fn=collate_detection,
        generator=generator,
    )
    model = build_model(config, pretrained=True).to(args.device)
    parameters = [value for value in model.parameters() if value.requires_grad]
    optimizer = torch.optim.SGD(parameters, lr=config.learning_rate, momentum=config.momentum, weight_decay=config.weight_decay)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)
    manifest_digest = sha256_file(args.manifest)
    source_weight = Path.home() / ".cache/torch/hub/checkpoints/fasterrcnn_resnet50_fpn_v2_coco-dd69338a.pth"
    provenance = {
        "schema": "parkright-a2-training-provenance-v1",
        "dataset_version": "a2-sim-v1-b569da957c",
        "dataset_manifest": str(args.manifest.resolve()),
        "dataset_manifest_sha256": manifest_digest,
        "training_commit": git_commit(),
        "config_sha256": config.sha256(),
        "config": config.to_dict(),
        "torch": torch.__version__,
        "torchvision": torchvision.__version__,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "device": args.device,
        "source_weights_sha256": sha256_file(source_weight),
        "train_images": len(train_records),
        "validation_images": len(validation_records),
    }
    (args.artifacts / "training-provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    history, best_metric, best_path = [], -1.0, args.artifacts / "best.pt"
    training_started = time.perf_counter()
    for epoch in range(config.epochs):
        train_dataset.set_epoch(epoch)
        model.train()
        losses = []
        epoch_started = time.perf_counter()
        for step, (images, targets) in enumerate(loader, 1):
            images = [image.to(args.device) for image in images]
            targets = [{key: value.to(args.device) for key, value in target.items()} for target in targets]
            loss_dict = model(images, targets)
            loss = sum(loss_dict.values())
            if not torch.isfinite(loss):
                raise RuntimeError(f"non-finite loss at epoch={epoch + 1} step={step}")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.detach()))
            if step % 100 == 0:
                print(json.dumps({"epoch": epoch + 1, "step": step, "loss": sum(losses[-100:]) / len(losses[-100:])}), flush=True)
        scheduler.step()
        validation = evaluate(model, validation_records, config, args.device)
        metric = validation["overall"]["detector"]["vehicle_binary"]["map_50_95"]
        entry = {
            "epoch": epoch + 1,
            "train_loss_mean": sum(losses) / len(losses),
            "seconds": time.perf_counter() - epoch_started,
            "learning_rate_next": scheduler.get_last_lr()[0],
            "validation": validation,
        }
        history.append(entry)
        write_summary({"schema": "parkright-a2-training-history-v1", "epochs": history}, args.artifacts / "history.json")
        checkpoint = {
            "model": model.state_dict(),
            "epoch": epoch + 1,
            "selection_metric": metric,
            "config_sha256": config.sha256(),
            "dataset_manifest_sha256": manifest_digest,
        }
        torch.save(checkpoint, args.artifacts / f"epoch-{epoch + 1:02d}.pt")
        if metric > best_metric:
            best_metric = metric
            torch.save(checkpoint, best_path)
        print(json.dumps({"epoch_complete": epoch + 1, "validation_map": metric, "best": best_metric}), flush=True)
    provenance["duration_seconds"] = time.perf_counter() - training_started
    provenance["selected_checkpoint"] = str(best_path)
    provenance["selected_validation_metric"] = best_metric
    (args.artifacts / "training-provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()

