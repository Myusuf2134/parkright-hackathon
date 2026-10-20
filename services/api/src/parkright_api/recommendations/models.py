"""Local recommendation DTOs; never change occupancy or shared contracts."""
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
PROVIDER = "nebius-token-factory"
Reason = Literal["availability", "walking_time", "distance", "occupancy", "traffic"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class ParkingOption(StrictModel):
    facility_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=120)
    total_spaces: int = Field(strict=True, ge=1, le=100000)
    available_spaces: int | None = Field(default=None, strict=True, ge=0)
    occupancy_percentage: float | None = Field(default=None, strict=True, ge=0, le=100)
    walking_minutes: float | None = Field(default=None, strict=True, ge=0, le=1440)
    distance_m: float | None = Field(default=None, strict=True, ge=0, le=1000000)
    traffic: Literal["light", "moderate", "heavy", "unknown"] = "unknown"
    status: Literal["open", "closed", "unknown"] = "unknown"
    is_simulated: bool = False
    observed_at: AwareDatetime

    @model_validator(mode="after")
    def consistent_counts(self):
        if self.available_spaces is not None:
            if self.available_spaces > self.total_spaces:
                raise ValueError("available_spaces exceeds total_spaces")
            if self.occupancy_percentage is not None and (
                self.available_spaces / self.total_spaces * 100 + self.occupancy_percentage > 100.01
            ):
                raise ValueError("available and occupied counts exceed capacity")
        return self


class RecommendationRequest(StrictModel):
    facilities: list[ParkingOption] = Field(min_length=1, max_length=10)
    destination: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [f.facility_id for f in self.facilities]
        if len(ids) != len(set(ids)):
            raise ValueError("facility IDs must be unique")
        return self


class ModelChoice(StrictModel):
    facility_id: str = Field(min_length=1, max_length=80)
    reasons: list[Reason] = Field(min_length=1, max_length=5)


class Provenance(StrictModel):
    provider: Literal["nebius-token-factory"] = PROVIDER
    model: Literal["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"] = MODEL
    latency_ms: float
    status: Literal["success", "fallback"]
    request_timestamp: datetime
    attempted: bool
    fallback_reason: str | None = None
    provider_response_id: str | None = None
    provider_reported_model: str | None = None


class RecommendationResponse(StrictModel):
    facility_id: str | None
    recommendation: str
    uncertainties: list[str]
    advisory_only: Literal[True] = True
    expires_at: datetime
    provenance: Provenance
