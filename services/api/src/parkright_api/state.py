"""Occupancy state for the configured facilities. In memory: the smallest state layer
the vertical slice needs. A persistent store can replace FacilityState behind the
same methods.

What is stored is the last *observation* of each space. What drivers see is
derived from it at read time, so staleness never depends on a background task:

    never observed .............................. UNCERTAIN  (stale = false, last_observed_at = null)
    observed longer ago than stale_after_ms ..... UNCERTAIN  (stale = true)
    otherwise ................................... the observed state (already safety-normalised)
"""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from parkright_contracts import (
    Camera,
    CameraConfig,
    Facility,
    FacilityConfig,
    Level,
    ModelRef,
    OccupancyChange,
    OccupancyObservation,
    OccupancyState,
    ParkingSpace,
    count_states,
)


@dataclass(slots=True)
class _Belief:
    state: OccupancyState
    confidence: float | None
    observed_at: datetime
    camera_id: str
    frame_seq: int
    model: ModelRef


class FacilityState:
    def __init__(self, config: FacilityConfig, stale_after_ms: int) -> None:
        self.config = config
        self._stale_after = timedelta(milliseconds=stale_after_ms)
        self._spaces = {s.space_id: s for s in config.spaces}
        self._beliefs: dict[str, _Belief] = {}
        self._last_frame_at: dict[str, datetime] = {}
        self._announced_stale: set[str] = set()

    @property
    def facility_id(self) -> str:
        return self.config.facility_id

    def camera(self, camera_id: str) -> CameraConfig | None:
        return next((c for c in self.config.cameras if c.camera_id == camera_id), None)

    # ---- reads ------------------------------------------------------------------------

    def _is_stale(self, belief: _Belief | None, now: datetime) -> bool:
        return belief is not None and now - belief.observed_at > self._stale_after

    def space(self, space_id: str, now: datetime) -> ParkingSpace:
        cfg = self._spaces[space_id]
        b = self._beliefs.get(space_id)
        stale = self._is_stale(b, now)
        live = b is not None and not stale
        return ParkingSpace(
            space_id=cfg.space_id,
            facility_id=self.facility_id,
            level_id=cfg.level_id,
            designation=cfg.designation,
            current_state=b.state if live else OccupancyState.UNCERTAIN,
            confidence=b.confidence if live else None,
            last_observed_at=b.observed_at if b else None,
            source_camera_id=b.camera_id if b else None,
            stale=stale,
            frame_seq=b.frame_seq if b else None,
            model=b.model if b else None,
        )

    def spaces(self, now: datetime) -> list[ParkingSpace]:
        return [self.space(s.space_id, now) for s in self.config.spaces]

    def facility(self, now: datetime) -> Facility:
        spaces = self.spaces(now)
        observed = [b.observed_at for b in self._beliefs.values()]
        return Facility(
            facility_id=self.facility_id,
            name=self.config.name,
            address=self.config.address,
            location=None,
            is_simulated=self.config.is_simulated,
            levels=[Level(level_id=lv.level_id, facility_id=self.facility_id, name=lv.name, ordinal=lv.ordinal) for lv in self.config.levels],
            cameras=[
                Camera(
                    camera_id=c.camera_id,
                    facility_id=self.facility_id,
                    level_id=c.level_id,
                    name=c.name,
                    kind=c.kind,
                    online=(at := self._last_frame_at.get(c.camera_id)) is not None and now - at <= self._stale_after,
                    last_frame_at=self._last_frame_at.get(c.camera_id),
                )
                for c in self.config.cameras
            ],
            counts=count_states([s.current_state for s in spaces]),
            updated_at=max(observed) if observed else None,
        )

    # ---- writes -----------------------------------------------------------------------

    def apply(self, observations: list[OccupancyObservation], received_at: datetime) -> list[OccupancyChange]:
        """Records a frame's observations (timestamped with server receive time) and returns
        the driver-visible changes they caused."""
        before = {o.space_id: self.space(o.space_id, received_at) for o in observations if o.space_id in self._spaces}
        for o in observations:
            if o.space_id not in self._spaces:
                continue
            self._beliefs[o.space_id] = _Belief(o.state, o.confidence, received_at, o.camera_id, o.frame_seq, o.model)
            self._announced_stale.discard(o.space_id)
        if observations:
            self._last_frame_at[observations[0].camera_id] = received_at
        changes = []
        for space_id, prev in before.items():
            now = self.space(space_id, received_at)
            if now.current_state != prev.current_state:
                changes.append(self._change(now, prev.current_state, "observation"))
        return changes

    def sweep(self, now: datetime) -> tuple[bool, list[OccupancyChange]]:
        """Notices evidence that has gone stale since the last sweep. Returns whether anything
        newly went stale, and the driver-visible changes that caused."""
        newly = [sid for sid, b in self._beliefs.items() if sid not in self._announced_stale and self._is_stale(b, now)]
        changes = []
        for sid in newly:
            self._announced_stale.add(sid)
            previous = self._beliefs[sid].state
            if previous is not OccupancyState.UNCERTAIN:
                changes.append(self._change(self.space(sid, now), previous, "stale"))
        return bool(newly), changes

    def _change(self, space: ParkingSpace, previous: OccupancyState, reason: str) -> OccupancyChange:
        return OccupancyChange(
            space_id=space.space_id,
            level_id=space.level_id,
            state=space.current_state,
            previous_state=previous,
            confidence=space.confidence,
            source_camera_id=space.source_camera_id,
            reason=reason,
        )


class FacilityRegistry:
    def __init__(self, facilities: list[FacilityState]) -> None:
        self._by_id = {f.facility_id: f for f in facilities}
        self._by_camera = {c.camera_id: f for f in facilities for c in f.config.cameras}
        if len(self._by_camera) != sum(len(f.config.cameras) for f in facilities):
            raise ValueError("camera ids must be unique across facilities")

    @classmethod
    def from_fixtures(cls, paths: list[Path], stale_after_ms: int) -> "FacilityRegistry":
        return cls([FacilityState(FacilityConfig.model_validate(json.loads(Path(p).read_text())), stale_after_ms) for p in paths])

    def all(self) -> list[FacilityState]:
        return list(self._by_id.values())

    def get(self, facility_id: str) -> FacilityState | None:
        return self._by_id.get(facility_id)

    def for_camera(self, camera_id: str) -> FacilityState | None:
        return self._by_camera.get(camera_id)
