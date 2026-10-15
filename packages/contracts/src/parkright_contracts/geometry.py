from pydantic import BaseModel, ConfigDict, Field


class Point(BaseModel):
    """Normalised 0…1, origin top-left."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    x: float
    y: float


class Rect(BaseModel):
    """Normalised 0…1, origin top-left."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
