"""The demo availability feed: SIMULATED, confirmed availability for the demo garages.

This is the one place in the demo where a space is treated as available, and it is
deliberately separate from perception:

* it never reads or writes FacilityState, so it cannot turn an UNCERTAIN bay into OPEN;
* perception still runs with allow_open false; the camera bays it watches stay
  OCCUPIED or UNCERTAIN and are reported as such;
* every value it returns is tagged ``source = "demo-fixture"`` and ``simulated = True``,
  and the driver UI labels it as simulated.

A real deployment would replace this with an availability source that can actually
confirm open spaces (an OPEN-capable detector after a false-OPEN evaluation, or a
facility feed). Nothing here should be read as live garage data.
"""

from dataclasses import dataclass
from typing import Literal

from .fixtures import Candidate, DemoScenario

SOURCE: Literal["demo-fixture"] = "demo-fixture"


@dataclass(frozen=True, slots=True)
class DemoAvailability:
    facility_id: str
    available_spaces: int
    total_spaces: int
    space_level: str
    space_id: str
    source: Literal["demo-fixture"] = SOURCE
    simulated: Literal[True] = True


class DemoAvailabilityFeed:
    def __init__(self, scenario: DemoScenario) -> None:
        self._scenario = scenario

    def for_candidate(self, candidate: Candidate) -> DemoAvailability:
        return DemoAvailability(
            facility_id=candidate.facility_id,
            available_spaces=candidate.demo_available_spaces,
            total_spaces=candidate.total_spaces,
            space_level=candidate.demo_space.level,
            space_id=candidate.demo_space.space_id,
        )

    def all(self) -> list[DemoAvailability]:
        return [self.for_candidate(c) for c in self._scenario.candidates]
