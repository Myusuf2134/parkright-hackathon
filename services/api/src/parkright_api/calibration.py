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
    def __init__(self, path: Path, allowed_camera_ids: tuple[str, ...] = ("cam-01",)):
        self.data = json.loads(path.read_text())
        self.sessions: OrderedDict[str, None] = OrderedDict()
        if not self.data["version"] or self.data["camera_id"] not in allowed_camera_ids:
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

    def for_camera(self, camera_id: str) -> "Calibration | None":
        """This calibration if it is the given camera's, else None."""
        return self if camera_id == self.data["camera_id"] else None

    def matches_view(self, camera):
        polygons = {
            s: [p.model_dump() for p in points] for s, points in camera.polygons.items()
        }
        return (
            camera.camera_id == self.data["camera_id"]
            and polygons == self.data["polygons"]
            and set(camera.watches) == set(polygons) | set(self.data["unobservable"])
        )


class CalibrationSet:
    """One calibration per camera, for a facility watched by several cameras (the showcase garage).

    Each camera keeps its own sessions, pose and polygons; a frame is checked only against its
    own camera's calibration. No two cameras may watch the same space: a bay has exactly one
    authoritative camera.
    """

    def __init__(self, paths: list[Path]):
        self.cameras: dict[str, Calibration] = {}
        for path in paths:
            data = json.loads(Path(path).read_text())
            cal = Calibration(Path(path), allowed_camera_ids=(data.get("camera_id", ""),))
            if cal.data["camera_id"] in self.cameras:
                raise ValueError(f"two calibrations for {cal.data['camera_id']}")
            self.cameras[cal.data["camera_id"]] = cal
        seen: dict[str, str] = {}
        for cid, cal in self.cameras.items():
            for space in cal.data["polygons"]:
                if space in seen:
                    raise ValueError(f"space {space} is calibrated for both {seen[space]} and {cid}")
                seen[space] = cid
        if not self.cameras:
            raise ValueError("no calibrations")

    def for_camera(self, camera_id: str) -> Calibration | None:
        return self.cameras.get(camera_id)

    @property
    def data(self) -> dict:
        return {
            "version": "+".join(c.data["version"] for c in self.cameras.values()),
            "camera_id": None,
            "cameras": {cid: c.data for cid, c in self.cameras.items()},
        }

    def check_facility(self, facility_config) -> None:
        """Every facility camera has a calibration that matches its view, and ownership is exclusive."""
        owners: dict[str, str] = {}
        for camera in facility_config.cameras:
            cal = self.cameras.get(camera.camera_id)
            if cal is None or not cal.matches_view(camera):
                raise ValueError(f"facility polygons differ from calibration for {camera.camera_id}")
            for space in camera.watches:
                if space in owners:
                    raise ValueError(f"space {space} is watched by both {owners[space]} and {camera.camera_id}")
                owners[space] = camera.camera_id
