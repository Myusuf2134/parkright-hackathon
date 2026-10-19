import asyncio
import io
import json
from pathlib import Path
from PIL import Image
import pytest
from fastapi.testclient import TestClient
from parkright_api.calibration import Calibration, CalibrationBinding
from parkright_api.config import Settings
from parkright_api.main import create_app
from parkright_contracts import FrameMetadata
from parkright_perception import CameraView, Frame, WatchedSpace
from parkright_perception.a0.provider import A0Provider
from parkright_perception.a0.detector import DetectionResult
from datetime import UTC, datetime

ROOT = Path(__file__).resolve().parents[4]
CAL = ROOT / "packages/shared/calibration/cam-01.json"


def test_calibration_rejects_pose_and_polygon_mismatch(tmp_path):
    c = Calibration(CAL)
    with pytest.raises(ValueError, match="mismatch"):
        c.bind(
            CalibrationBinding(
                session_id="s",
                version=c.data["version"],
                pose={**c.data["pose"], "yaw": 12},
            )
        )
    broken = json.loads(CAL.read_text())
    broken["polygons"]["A1"] = [{"x": -1, "y": 0}] * 4
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(broken))
    with pytest.raises(ValueError, match="polygon"):
        Calibration(path)


def test_session_binding_and_dimensions():
    c = json.loads(CAL.read_text())
    app = create_app(
        Settings(
            env="test",
            calibration_file=CAL,
            facility_fixtures=[CAL.with_name("facility.json")],
            ingest_token="test",
            _env_file=None,
        )
    )
    meta = FrameMetadata(
        camera_id="cam-01",
        session_id="bound",
        seq=0,
        sim_time_ms=0,
        captured_at=datetime.now(UTC),
    )
    buffer = io.BytesIO()
    Image.new("RGB", (100, 100)).save(buffer, "JPEG")
    with TestClient(app) as client:

        def send():
            return client.post(
                "/api/v1/cameras/cam-01/frames",
                headers={"authorization": "Bearer test"},
                data={"metadata": meta.model_dump_json()},
                files={"image": ("frame.jpg", buffer.getvalue(), "image/jpeg")},
            )

        assert send().json()["error"]["code"] == "calibration_required"
        body = {"session_id": "bound", "version": c["version"], "pose": c["pose"]}
        assert (
            client.post("/api/v1/cameras/cam-01/calibration", json=body).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/cameras/cam-01/calibration",
                json=body,
                headers={"authorization": "Bearer test"},
            ).status_code
            == 200
        )
        assert send().json()["error"]["code"] == "calibration_mismatch"


def test_timeout_discards_late_result_and_recovers():
    import threading

    class Slow:
        identity = "TEST STUB timeout only"
        release = threading.Event()

        def detect(self, image):
            self.release.wait(2)
            return DetectionResult(())

    async def check():
        d = Slow()
        p = A0Provider(d)
        from PIL import ImageDraw

        image = Image.new("RGB", (128, 128), "gray")
        ImageDraw.Draw(image).rectangle((0, 0, 64, 64), fill="white")
        b = io.BytesIO()
        image.save(b, "JPEG")
        f = Frame(
            FrameMetadata(
                camera_id="cam-01",
                session_id="s",
                seq=1,
                sim_time_ms=0,
                captured_at=datetime.now(UTC),
            ),
            b.getvalue(),
        )
        view = CameraView("cam-01", (WatchedSpace("A1", None),))
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(p.infer(f, view), 0.02)
        assert p.diagnostics()["phase"] == "degraded"
        with pytest.raises(TimeoutError):
            await p.infer(f, view)
        d.release.set()
        await p._active
        assert p.diagnostics()["error"] == "timeout; worker output discarded"
        result = await p.infer(f, view)
        assert result[0].state == "UNCERTAIN" and p.diagnostics()["error"] is None

    asyncio.run(check())


def test_api_timeout_does_not_apply_late_occupancy():
    import threading
    import httpx
    from PIL import ImageDraw
    from parkright_perception.a0.detector import Detection

    class Slow:
        identity = "TEST STUB late result only"
        release = threading.Event()
        calls = 0

        def detect(self, image):
            self.calls += 1
            if self.calls == 1:
                self.release.wait(2)
                return DetectionResult((Detection("car", 0.99, (0, 0, 1, 1)),))
            return DetectionResult(())

    async def check():
        detector = Slow()
        provider = A0Provider(detector)
        app = create_app(
            Settings(env="test", perception_timeout_s=0.02, _env_file=None), provider
        )
        image = Image.new("RGB", (128, 128), "gray")
        ImageDraw.Draw(image).rectangle((0, 0, 64, 64), fill="white")
        b = io.BytesIO()
        image.save(b, "JPEG")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            async def send(seq):
                m = FrameMetadata(
                    camera_id="cam-01",
                    session_id="s",
                    seq=seq,
                    sim_time_ms=seq,
                    captured_at=datetime.now(UTC),
                )
                return await client.post(
                    "/api/v1/cameras/cam-01/frames",
                    data={"metadata": m.model_dump_json()},
                    files={"image": ("frame.jpg", b.getvalue(), "image/jpeg")},
                )

            assert (await send(0)).status_code == 503
            detector.release.set()
            await provider._active
            state = (await client.get("/api/v1/facilities/garage-01/spaces")).json()
            assert all(s["frame_seq"] is None for s in state["spaces"])
            assert (await send(0)).status_code == 202
            assert (await send(1)).status_code == 202
            state = (await client.get("/api/v1/facilities/garage-01/spaces")).json()
            assert all(
                s["frame_seq"] == 1 and s["current_state"] == "UNCERTAIN"
                for s in state["spaces"]
            )

    asyncio.run(check())


def test_missing_weights_reports_unavailable(monkeypatch):
    from parkright_perception.a0.provider import from_environment

    monkeypatch.delenv("PARKRIGHT_A0_SOURCE", raising=False)
    monkeypatch.delenv("PARKRIGHT_A0_WEIGHTS", raising=False)
    p = from_environment()
    asyncio.run(p.warmup())
    state = p.diagnostics()
    assert state["phase"] == "unavailable"
    assert (
        not state["weights_available"]
        and not state["model_loaded"]
        and not state["inference_ready"]
    )
