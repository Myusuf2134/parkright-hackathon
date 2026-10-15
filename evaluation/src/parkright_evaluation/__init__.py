"""Ground truth and perception scoring. Allowed to read production output; never the other way round."""

from .store import GroundTruthStore

__all__ = ["GroundTruthStore"]
