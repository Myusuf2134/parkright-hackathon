from parkright_contracts import ModelRef, OccupancyState

from ..provider import CameraView, Frame, SpaceInference


class UncertainProvider:
    """The default until a detector arm is connected: it looks at nothing and claims nothing.
    Every space is UNCERTAIN, so drivers are never shown availability no model produced."""

    model = ModelRef(provider="none", version="0")

    async def infer(self, frame: Frame, view: CameraView) -> list[SpaceInference]:
        return [SpaceInference(space_id=s.space_id, state=OccupancyState.UNCERTAIN, confidence=None) for s in view.spaces]
