"""Demo-mode runtime state: the scenario, the latest camera frame, and reset.

Only created when PARKRIGHT_DEMO_MODE is on. Holds nothing the production path reads.
"""

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

from parkright_contracts import OccupancyUpdateMessage, count_states

from ..recommendations.client import NemotronClient
from ..stream_tracker import FrameStreamTracker
from .availability import DemoAvailabilityFeed
from .fixtures import DemoScenario, fixture_sha256, load_scenario
from .recommend import NemotronMode

VEHICLE_LABELS = frozenset({"car", "truck", "bus"})


@dataclass(slots=True)
class LatestFrame:
    camera_id: str
    session_id: str
    seq: int
    received_at: datetime
    jpeg: bytes
    detections: list[dict]
    timings: dict


@dataclass(slots=True)
class DemoRuntime:
    nemotron_mode: NemotronMode
    scenario: DemoScenario = field(default_factory=load_scenario)
    fixture_sha256: str = field(default_factory=fixture_sha256)
    epoch: int = 0
    reset_at: datetime | None = None
    frames_since_reset: int = 0
    latest: LatestFrame | None = None
    latest_by_camera: dict[str, LatestFrame] = field(default_factory=dict)
    #: Real perception events (one per processed frame), newest last. Nothing here is invented.
    events: deque = field(default_factory=lambda: deque(maxlen=60))
    event_seq: int = 0
    feed: DemoAvailabilityFeed = field(init=False)

    def __post_init__(self) -> None:
        self.feed = DemoAvailabilityFeed(self.scenario)

    def client(self, live_client: NemotronClient) -> NemotronClient:
        """Fallback mode never calls Nebius, even when a key is present."""
        return live_client if self.nemotron_mode == "live" else NemotronClient(api_key="")

    def record_frame(self, camera_id: str, session_id: str, seq: int, received_at: datetime, jpeg: bytes, diagnostics: dict, changes=()) -> None:
        detections = [
            {"label": d.get("label"), "confidence": round(float(d.get("confidence", 0)), 3), "box": [round(float(v), 4) for v in d.get("box", [])]}
            for d in diagnostics.get("detections") or [] if d.get("label") in VEHICLE_LABELS
        ]
        timings = dict(diagnostics.get("timings") or {})
        self.latest = LatestFrame(camera_id, session_id, seq, received_at, jpeg, detections, timings)
        self.latest_by_camera[camera_id] = self.latest
        self.frames_since_reset += 1
        self.event_seq += 1
        self.events.append({
            "id": self.event_seq,
            "at": received_at.isoformat(),
            "camera_id": camera_id,
            "seq": seq,
            "vehicles": sum(1 for d in detections if d["confidence"] >= 0.65),
            "a2_ms": round(timings.get("total_ms", 0)),
            "changes": [
                {"space_id": c.space_id, "from": c.previous_state.value if c.previous_state else None, "to": c.state.value}
                for c in changes
            ],
        })

    def reset(self, app, now: datetime) -> None:
        """Back to a known state: no evidence, no stream history, no cached frame."""
        for facility in app.state.registry.all():
            facility.reset()
            spaces = facility.spaces(now)
            app.state.hub.publish(facility.facility_id, OccupancyUpdateMessage(
                facility_id=facility.facility_id, changes=[], counts=count_states([s.current_state for s in spaces]),
                spaces=spaces, frame=None, published_at=now,
            ).model_dump_json())
        app.state.tracker = FrameStreamTracker(app.state.settings.frame_max_age_ms)
        self.latest = None
        self.latest_by_camera.clear()
        self.events.clear()
        self.frames_since_reset = 0
        self.epoch += 1
        self.reset_at = now
