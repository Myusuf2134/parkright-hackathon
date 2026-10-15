import pytest
from starlette.websockets import WebSocketDisconnect

from parkright_contracts import OccupancyState as S

from .conftest import FACILITY, meta, send


def test_snapshot_then_update_per_accepted_frame(client, provider):
    with client.websocket_connect(f"/api/v1/realtime?facility_id={FACILITY}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["type"] == "facility_snapshot" and len(snapshot["spaces"]) == 12
        assert snapshot["facility"]["counts"]["uncertain"] == 12

        # The dummy-provider slice: nothing changes, but subscribers still hear about the frame.
        provider.all(S.UNCERTAIN, None)
        send(client, meta(0))
        update = ws.receive_json()
        assert update["type"] == "occupancy_update" and update["changes"] == []
        assert update["frame"]["seq"] == 0 and update["spaces"][0]["last_observed_at"] is not None

        provider.all(S.OCCUPIED, 0.9)
        send(client, meta(1))
        update = ws.receive_json()
        assert update["counts"]["occupied"] == 12
        assert update["changes"][0] == {
            "space_id": "A1", "level_id": "L1", "state": "OCCUPIED", "previous_state": "UNCERTAIN", "confidence": 0.9,
            "source_camera_id": "cam-01", "reason": "observation",
        }


def test_frames_that_are_not_accepted_publish_nothing(client, provider):
    with client.websocket_connect(f"/api/v1/realtime?facility_id={FACILITY}") as ws:
        ws.receive_json()
        send(client, meta(0))
        ws.receive_json()
        send(client, meta(0))  # duplicate
        send(client, meta(1))
        assert ws.receive_json()["frame"]["seq"] == 1


def test_unknown_facility_is_refused(client):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/api/v1/realtime?facility_id=nowhere") as ws:
            ws.receive_json()
    assert e.value.code == 1008
