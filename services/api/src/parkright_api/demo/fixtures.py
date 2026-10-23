"""The hackathon demo scenario: one fixed, validated fixture file.

Everything the demo shows that ParkRight does not measure (the student, the class, the
garage candidates, walking times, traffic and the simulated availability feed) comes
from packages/shared/fixtures/hackathon-demo.json. None of it is live data.
"""

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..config import REPO_ROOT

DEMO_FIXTURE = REPO_ROOT / "packages" / "shared" / "fixtures" / "hackathon-demo.json"
SCHEMA = "parkright-hackathon-demo-v1"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Student(_Strict):
    name: str


class NextClass(_Strict):
    time: str
    course: str
    destination: str
    destination_short: str


class SimulatorScene(_Strict):
    facility_id: str
    camera_id: str
    seed: int
    environment: str
    occupied_bays: list[str]
    hash: str
    stream_fps: int = Field(ge=1, le=5)


class DemoSpace(_Strict):
    level: str
    space_id: str


class Candidate(_Strict):
    facility_id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    walking_minutes: int = Field(ge=0)
    distance_m: int = Field(ge=0)
    traffic: Literal["light", "moderate", "heavy"]
    status: Literal["open", "closed"]
    total_spaces: int = Field(ge=1)
    demo_available_spaces: int = Field(ge=0)
    demo_space: DemoSpace

    @model_validator(mode="after")
    def _fits(self) -> "Candidate":
        if self.demo_available_spaces > self.total_spaces:
            raise ValueError("demo availability exceeds capacity")
        return self


class Expected(_Strict):
    facility_id: str
    garage: str
    level: str
    space_id: str
    walking_minutes: int
    camera_occupied_bays: list[str]


class DemoScenario(_Strict):
    schema_: Literal["parkright-hackathon-demo-v1"] = Field(alias="schema")
    scenario_id: str
    disclaimer: str
    student: Student
    next_class: NextClass
    simulator: SimulatorScene
    camera_garage: str
    candidates: list[Candidate] = Field(min_length=2, max_length=5)
    expected: Expected

    @model_validator(mode="after")
    def _consistent(self) -> "DemoScenario":
        ids = [c.facility_id for c in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate ids must be unique")
        if self.camera_garage not in ids or self.expected.facility_id not in ids:
            raise ValueError("camera_garage and expected garage must be candidates")
        chosen = self.candidate(self.expected.facility_id)
        if (chosen.name, chosen.demo_space.level, chosen.demo_space.space_id, chosen.walking_minutes) != (
            self.expected.garage, self.expected.level, self.expected.space_id, self.expected.walking_minutes,
        ):
            raise ValueError("expected result disagrees with its candidate")
        if sorted(self.expected.camera_occupied_bays) != sorted(self.simulator.occupied_bays):
            raise ValueError("expected camera result disagrees with the simulator scene")
        return self

    def candidate(self, facility_id: str) -> Candidate:
        return next(c for c in self.candidates if c.facility_id == facility_id)


def fixture_sha256(path: Path = DEMO_FIXTURE) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@lru_cache(maxsize=4)
def load_scenario(path: Path = DEMO_FIXTURE) -> DemoScenario:
    return DemoScenario.model_validate(json.loads(Path(path).read_text()))
