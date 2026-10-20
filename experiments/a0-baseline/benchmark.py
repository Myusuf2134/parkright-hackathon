"""Real model benchmark. No test-stub substitution; fail if inference fails."""

import argparse
import asyncio
import json
import platform
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean

import numpy as np
from parkright_contracts import FacilityConfig, FrameMetadata
from parkright_perception import CameraView, Frame, WatchedSpace
from parkright_perception.a0.provider import from_environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jpeg", type=Path)
    parser.add_argument("--facility", type=Path, required=True)
    parser.add_argument("--camera", default="cam-01")
    parser.add_argument("--runs", type=int, default=10)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    config = FacilityConfig.model_validate_json(args.facility.read_text())
    camera = next(c for c in config.cameras if c.camera_id == args.camera)
    view = CameraView(
        camera.camera_id,
        tuple(
            WatchedSpace(s, tuple(camera.polygons[s]) if s in camera.polygons else None)
            for s in camera.watches
        ),
    )
    frame = Frame(
        FrameMetadata(
            camera_id=camera.camera_id,
            session_id="benchmark",
            seq=0,
            sim_time_ms=0,
            captured_at=datetime.now(UTC),
        ),
        args.jpeg.read_bytes(),
    )
    provider = from_environment()
    samples = []
    for _ in range(args.runs + 1):
        output = asyncio.run(provider.infer(frame, view))
        if provider.last_error or provider.last_timings["inference_ms"] == 0:
            raise RuntimeError(f"No successful real inference: {provider.last_error}")
        samples.append(provider.last_timings.copy())
    print(
        json.dumps(
            {
                "mode": "REAL MODEL",
                "platform": platform.platform(),
                "identity": provider.detector.identity,
                "model": provider.model.model_dump(),
                "thresholds": asdict(provider.config),
                "cold": samples[0],
                "warm": {
                    key: {
                        "mean": mean(s[key] for s in samples[1:]),
                        "p95": float(np.percentile([s[key] for s in samples[1:]], 95)),
                    }
                    for key in samples[0]
                },
                "states": [
                    {
                        "space_id": r.space_id,
                        "state": r.state,
                        "confidence": r.confidence,
                    }
                    for r in output
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
