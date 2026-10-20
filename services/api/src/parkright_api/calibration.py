"""Production calibration binding, independent of frame contracts and evaluation."""

import json
from collections import OrderedDict
from pathlib import Path

from pydantic import BaseModel, ConfigDict
from shapely.geometry import Polygon

from parkright_contracts import SessionId


class CalibrationBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: SessionId
    version: str
    pose: dict


class Calibration:
    def __init__(self, path: Path):
        self.data = json.loads(path.read_text())
        self.sessions: OrderedDict[str, None] = OrderedDict()
        if not self.data["version"] or self.data["camera_id"] != "cam-01":
            raise ValueError("invalid calibration identity")
        pose = self.data["pose"]
        if pose["width"] != 1280 or pose["height"] != 720:
            raise ValueError("canonical capture must be 1280x720")
        for name, points in self.data["polygons"].items():
            if len(points) < 3 or any(
                not 0 <= p[k] <= 1 for p in points for k in ("x", "y")
            ):
                raise ValueError(f"invalid polygon {name}")
            poly = Polygon([(p["x"], p["y"]) for p in points])
            if not poly.is_valid or poly.area <= 0:
                raise ValueError(f"invalid polygon {name}")

    def bind(self, request: CalibrationBinding):
        if request.version != self.data["version"] or request.pose != self.data["pose"]:
            raise ValueError("camera pose/resolution/calibration mismatch")
        self.sessions[request.session_id] = None
        self.sessions.move_to_end(request.session_id)
        while len(self.sessions) > 128:
            self.sessions.popitem(last=False)

    def matches_view(self, camera):
        polygons = {
            s: [p.model_dump() for p in points] for s, points in camera.polygons.items()
        }
        return (
            camera.camera_id == self.data["camera_id"]
            and polygons == self.data["polygons"]
            and set(camera.watches) == set(polygons) | set(self.data["unobservable"])
        )
