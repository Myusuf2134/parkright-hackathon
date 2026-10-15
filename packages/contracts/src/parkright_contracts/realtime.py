"""Messages on the realtime socket: WS /api/v1/realtime?facility_id=…"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .facility import Facility
from .occupancy import OccupancyUpdateMessage, ParkingSpace


class FacilitySnapshotMessage(BaseModel):
    """Sent once on connect: the whole current state, so clients never start from partial data."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    type: Literal["facility_snapshot"] = "facility_snapshot"
    facility: Facility
    spaces: list[ParkingSpace]


RealtimeMessage = Annotated[FacilitySnapshotMessage | OccupancyUpdateMessage, Field(discriminator="type")]
