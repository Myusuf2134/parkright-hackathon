import json
import time

import pytest

from parkright_contracts import OccupancyState as S

from .conftest import CAMERA, JPEG, SPACES, meta, occupancy, send, state_of


def test_valid_frame_is_accepted_and_updates_state(client, provider):
    provider.all(S.OCCUPIED, 0.91, A1=(S.OPEN, 0.88))
    res = send(client, meta(0))
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["outcome"] == "accepted" and body["model"] == {"provider": "test-arm", "version": "1"}
    assert [o["space_id"] for o in body["observations"]] == SPACES
    assert body["observations"][0] | {"captured_at": None} == {
        "space_id": "A1", "state": "OPEN", "confidence": 0.88, "camera_id": CAMERA, "session_id": "run-1",
        "frame_seq": 0, "sim_time_ms": 0, "captured_at": None, "model": {"provider": "test-arm", "version": "1"},
    }
    o = occupancy(client)
    assert o["counts"] == {"total": 12, "open": 1, "occupied": 11, "uncertain": 0}
    assert state_of(o, "A1") | {"last_observed_at": None} == {
        "space_id": "A1", "facility_id": "garage-01", "level_id": "L1", "designation": "standard", "current_state": "OPEN",
        "confidence": 0.88, "last_observed_at": None, "source_camera_id": CAMERA, "stale": False, "frame_seq": 0,
        "model": {"provider": "test-arm", "version": "1"},
    }


def test_missing_metadata(client):
    res = send(client)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "missing_metadata")


@pytest.mark.parametrize("key", ["session_id", "camera_id", "seq", "sim_time_ms", "captured_at"])
def test_metadata_missing_a_field(client, key):
    m = meta(0)
    del m[key]
    res = send(client, m)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "invalid_metadata")


def test_malformed_metadata_and_missing_image(client):
    assert send(client, "{nope").json()["error"]["code"] == "invalid_metadata"
    only_metadata = [("metadata", (None, json.dumps(meta(0)), "application/json"))]
    res = client.post(f"/api/v1/cameras/{CAMERA}/frames", files=only_metadata)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "missing_image")


def test_metadata_as_json_blob_part(client):
    files = [("metadata", ("metadata.json", json.dumps(meta(0)), "application/json")), ("image", ("f.jpg", JPEG, "image/jpeg"))]
    assert client.post(f"/api/v1/cameras/{CAMERA}/frames", files=files).status_code == 202


def test_wrong_content_type(client, provider):
    assert send(client, meta(0), image_type="image/png").status_code == 415
    assert send(client, meta(0), image=b"\x89PNG\r\n\x1a\nnot a jpeg").status_code == 415
    as_json = client.post(f"/api/v1/cameras/{CAMERA}/frames", json=meta(0))
    assert (as_json.status_code, as_json.json()["error"]["code"]) == (415, "unsupported_media_type")
    assert provider.calls == []


def test_oversized_frame(make_client, provider):
    client = make_client(frame_max_bytes=32 * 1024)
    big = JPEG[:3] + b"\x00" * (32 * 1024 + 1)
    assert send(client, meta(0), image=big).status_code == 413
    # Past even the whole-request cap: rejected before parsing.
    huge = JPEG[:3] + b"\x00" * (200 * 1024)
    assert send(client, meta(0), image=huge).status_code == 413
    assert provider.calls == []


def test_camera_identity(client):
    assert send(client, meta(0, camera_id="cam-02")).json()["error"]["code"] == "camera_mismatch"
    assert send(client, meta(0, camera_id="cam-99"), camera="cam-99").json()["error"]["code"] == "unknown_camera"
    assert send(client, meta(0), camera="..").status_code in (400, 404)
    assert send(client, meta(0), camera="cam%2F01").status_code in (400, 404)


def test_ingest_token(make_client):
    client = make_client(ingest_token="s3cret-token")
    assert send(client, meta(0)).status_code == 401
    assert send(client, meta(0), headers={"authorization": "Bearer wrong"}).status_code == 401
    assert send(client, meta(0), headers={"authorization": "Bearer s3cret-token"}).status_code == 202


def test_duplicate_seq_is_idempotent(client, provider):
    provider.all(S.OCCUPIED, 0.9)
    assert send(client, meta(7)).status_code == 202
    dup = send(client, meta(7))
    assert dup.status_code == 200
    assert dup.json() | {"detail": None} == {
        "outcome": "duplicate", "camera_id": CAMERA, "session_id": "run-1", "seq": 7, "observations": [], "model": None,
        "changed": 0, "gap": 0, "detail": None,
    }
    assert len(provider.calls) == 1


def test_out_of_order_frame_does_not_overwrite_newer_state(client, provider):
    provider.all(S.OCCUPIED, 0.9)
    send(client, meta(10))
    provider.all(S.OPEN, 0.99)
    late = send(client, meta(9))
    assert (late.status_code, late.json()["outcome"]) == (200, "out_of_order")
    assert occupancy(client)["counts"]["occupied"] == 12


def test_stale_frame_is_recorded_but_does_not_change_state(client, provider):
    provider.all(S.OCCUPIED, 0.9)
    send(client, meta(1))
    provider.all(S.OPEN, 0.99)
    stale = send(client, meta(2, captured_at="2020-01-01T00:00:00Z"))
    assert stale.json()["outcome"] == "stale"
    assert len(provider.calls) == 1
    assert occupancy(client)["counts"]["open"] == 0


def test_session_restart_and_late_frames_from_the_old_session(client, provider):
    provider.all(S.OCCUPIED, 0.9)
    send(client, meta(500))
    assert send(client, meta(0, session_id="run-2")).json()["outcome"] == "accepted"
    assert send(client, meta(501)).json()["outcome"] == "superseded_session"


def test_sim_time_going_backwards_is_a_conflict(client):
    send(client, meta(3))
    assert send(client, meta(4, sim_time_ms=0)).status_code == 409


def test_gap_is_reported(client):
    send(client, meta(1))
    assert send(client, meta(4)).json()["gap"] == 2


def test_perception_timeout_does_not_consume_the_frame(make_client, provider):
    client = make_client(perception_timeout_s=0.05)
    provider.delay_s = 0.2
    assert send(client, meta(0)).status_code == 503
    provider.delay_s = 0
    assert send(client, meta(0)).json()["outcome"] == "accepted"


def test_default_settings_expose_stale_evidence_as_uncertain(make_client, provider):
    client = make_client(stale_after_ms=100)
    provider.all(S.OPEN, 0.95)
    send(client, meta(0))
    assert occupancy(client)["counts"]["open"] == 12
    time.sleep(0.2)
    o = occupancy(client)
    assert o["counts"] == {"total": 12, "open": 0, "occupied": 0, "uncertain": 12}
    assert state_of(o, "A1") | {"last_observed_at": None, "model": None} == state_of(o, "A1") | {
        "current_state": "UNCERTAIN", "stale": True, "confidence": None, "last_observed_at": None, "model": None,
    }
