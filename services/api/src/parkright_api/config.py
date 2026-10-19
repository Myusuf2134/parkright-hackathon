from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from parkright_contracts import FRAME_MAX_BYTES

REPO_ROOT = Path(__file__).resolve().parents[4]
MVP_FIXTURE = REPO_ROOT / "packages" / "shared" / "fixtures" / "mvp-facility.json"


class Settings(BaseSettings):
    """All configuration comes from PARKRIGHT_* environment variables (or .env)."""

    model_config = SettingsConfigDict(env_prefix="PARKRIGHT_", env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = 8400

    facility_fixtures: list[Path] = Field(default_factory=lambda: [MVP_FIXTURE])
    calibration_file: Path | None = None
    perception_provider: str = "none"
    perception_timeout_s: float = Field(default=10.0, gt=0)

    frame_max_bytes: int = Field(default=FRAME_MAX_BYTES, ge=1024, le=16 * 1024 * 1024)
    frame_max_age_ms: int = Field(default=10_000, gt=0, description="Older frames are recorded but do not change state.")
    stale_after_ms: int = Field(default=12_000, gt=0, description="Spaces not observed for this long become UNCERTAIN.")

    ingest_token: SecretStr | None = Field(default=None, description="Bearer token cameras (and ground truth) must send.")
    evaluation_enabled: bool | None = Field(default=None, description="Ground-truth route. Default: on except in production.")
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5180", "http://127.0.0.1:5180"])

    @model_validator(mode="after")
    def _production_rules(self) -> "Settings":
        if self.env == "production" and self.ingest_token is None:
            raise ValueError("PARKRIGHT_INGEST_TOKEN is required in production")
        return self

    @property
    def evaluation_on(self) -> bool:
        return self.evaluation_enabled if self.evaluation_enabled is not None else self.env != "production"
