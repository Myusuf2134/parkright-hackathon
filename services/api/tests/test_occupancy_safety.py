"""UNCERTAIN is never availability, and missing evidence never looks like an OPEN space."""

from datetime import UTC, datetime, timedelta

from parkright_api.config import MVP_FIXTURE
from parkright_api.state import FacilityRegistry
from parkright_contracts import ModelRef, OccupancyObservation, OccupancyState as S

from .conftest import meta, occupancy, send, state_of

T0 = datetime(2026, 10, 14, 12, tzinfo=UTC)
MODEL = ModelRef(provider="t", version="1")


def obs(space_id: str, state: S, confidence: float | None) -> OccupancyObservation:
    return OccupancyObservation(
        space_id=space_id, state=state, confidence=confidence, camera_id="cam-01", session_id="s", frame_seq=0,
        sim_time_ms=0, captured_at=T0, model=MODEL,
    )


def facility():
    return FacilityRegistry.from_fixtures([MVP_FIXTURE], stale_after_ms=12_000).get("garage-01")


def test_never_observed_is_uncertain_not_open():
    f = facility()
    assert all(s.current_state is S.UNCERTAIN and s.last_observed_at is None and not s.stale for s in f.spaces(T0))
    assert f.facility(T0).counts.open == 0


def test_uncertain_with_high_confidence_stays_uncertain(client, provider):
    provider.all(S.UNCERTAIN, 0.99)
    send(client, meta(0))
    o = occupancy(client)
    assert o["counts"] == {"total": 12, "open": 0, "occupied": 0, "uncertain": 12}
    assert state_of(o, "A1")["source_camera_id"] == "cam-01" and state_of(o, "A1")["frame_seq"] == 0


def test_low_confidence_and_unscored_open_are_uncertain(client, provider):
    provider.all(S.OPEN, 0.3, A1=(S.OPEN, None))
    observations = send(client, meta(0)).json()["observations"]
    assert {o["state"] for o in observations} == {"UNCERTAIN"}
    assert occupancy(client)["counts"]["open"] == 0


def test_space_the_provider_skipped_becomes_uncertain_not_its_previous_state(client, provider):
    provider.all(S.OPEN, 0.95)
    send(client, meta(0))
    inner = provider.answer
    provider.answer = lambda view: [r for r in inner(view) if r.space_id != "B6"]
    send(client, meta(1))
    assert state_of(occupancy(client), "B6")["current_state"] == "UNCERTAIN"


def test_stale_evidence_becomes_uncertain_and_sweep_reports_it():
    f = facility()
    changes = f.apply([obs("A1", S.OPEN, 0.9), obs("A2", S.UNCERTAIN, None)], T0)
    assert [(c.space_id, c.previous_state, c.state) for c in changes] == [("A1", S.UNCERTAIN, S.OPEN)]
    later = T0 + timedelta(seconds=13)
    assert f.space("A1", later).current_state is S.UNCERTAIN and f.space("A1", later).stale
    newly, swept = f.sweep(later)
    assert newly and [(c.space_id, c.previous_state, c.state, c.reason) for c in swept] == [("A1", S.OPEN, S.UNCERTAIN, "stale")]
    assert f.sweep(later + timedelta(seconds=1)) == (False, [])
    assert not f.facility(later).cameras[0].online
