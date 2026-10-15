import math
from collections import Counter

from parkright_contracts import ModelRef, OccupancyObservation, OccupancyState, safe_state

from .provider import CameraView, Frame, SpaceInference


def to_observations(frame: Frame, view: CameraView, model: ModelRef, raw: list[SpaceInference]) -> list[OccupancyObservation]:
    """Turns whatever a provider returned into observations the backend can trust.

    - exactly one observation per watched space, in the view's order;
    - a space the provider skipped, or reported more than once, is UNCERTAIN;
    - spaces the camera does not watch are dropped;
    - an invalid confidence (NaN, outside 0…1) makes the space UNCERTAIN;
    - OPEN below MIN_OPEN_CONFIDENCE, and OCCUPIED without a confidence, become UNCERTAIN;
    - provenance (camera, session, frame, model) comes from the pipeline, not the provider.
    """
    counts = Counter(r.space_id for r in raw)
    by_id = {r.space_id: r for r in raw if counts[r.space_id] == 1}
    m = frame.metadata
    out: list[OccupancyObservation] = []
    for space in view.spaces:
        r = by_id.get(space.space_id)
        valid = (
            r is not None
            and isinstance(r.state, OccupancyState)
            and (r.confidence is None or (isinstance(r.confidence, (int, float)) and math.isfinite(r.confidence) and 0 <= r.confidence <= 1))
        )
        state = safe_state(r.state, r.confidence) if valid else OccupancyState.UNCERTAIN
        out.append(
            OccupancyObservation(
                space_id=space.space_id,
                state=state,
                confidence=r.confidence if valid else None,
                camera_id=m.camera_id,
                session_id=m.session_id,
                frame_seq=m.seq,
                sim_time_ms=m.sim_time_ms,
                captured_at=m.captured_at,
                model=model,
            )
        )
    return out
