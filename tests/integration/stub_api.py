"""STUB INTEGRATION ONLY. Deliberate transport fixture, never registered in production."""

from pathlib import Path
import json
import uvicorn
from parkright_api.main import create_app
from parkright_api.config import Settings
from parkright_perception.a0.provider import A0Provider
from parkright_perception.a0.detector import Detection, DetectionResult

ROOT = Path(__file__).resolve().parents[2]


class StubDetector:
    identity = "TEST STUB INTEGRATION fixed A1 only"

    def detect(self, image):
        points = json.loads(
            (ROOT / "packages/shared/calibration/cam-01.json").read_text()
        )["polygons"]["A1"]
        return DetectionResult(
            (
                Detection(
                    "car",
                    0.99,
                    (
                        min(p["x"] for p in points),
                        min(p["y"] for p in points),
                        max(p["x"] for p in points),
                        max(p["y"] for p in points),
                    ),
                ),
            )
        )


if __name__ == "__main__":
    settings = Settings(
        calibration_file=ROOT / "packages/shared/calibration/cam-01.json",
        facility_fixtures=[ROOT / "packages/shared/calibration/facility.json"],
    )
    uvicorn.run(
        create_app(settings, A0Provider(StubDetector())),
        host="127.0.0.1",
        port=settings.port,
    )
