from .conftest import FACILITY


def test_facility_read_api(client):
    facilities = client.get("/api/v1/facilities").json()
    assert [f["facility_id"] for f in facilities] == [FACILITY]
    f = client.get(f"/api/v1/facilities/{FACILITY}").json()
    assert f["is_simulated"] is True and f["counts"]["total"] == 12
    assert f["cameras"] == [{"camera_id": "cam-01", "facility_id": FACILITY, "level_id": "L1", "name": "Virtual camera 1", "kind": "virtual", "online": False, "last_frame_at": None}]
    assert client.get(f"/api/v1/facilities/{FACILITY}/levels").json() == [{"level_id": "L1", "facility_id": FACILITY, "name": "Level 1", "ordinal": 0}]
    assert client.get(f"/api/v1/facilities/{FACILITY}/spaces?level_id=L1").json()["counts"]["total"] == 12
    assert client.get(f"/api/v1/facilities/{FACILITY}/spaces?level_id=L9").json()["counts"]["total"] == 0
    assert client.get(f"/api/v1/facilities/{FACILITY}/spaces/B6").json()["space_id"] == "B6"


def test_not_found(client):
    assert client.get("/api/v1/facilities/nowhere").status_code == 404
    assert client.get(f"/api/v1/facilities/{FACILITY}/spaces/Z9").json()["error"]["code"] == "not_found"


def test_health(client):
    h = client.get("/api/v1/health").json()
    assert h["status"] == "ok" and h["perception"] == {"provider": "test-arm", "version": "1"} and h["evaluation_enabled"] is True
