"""A stand-in camera for exercising the backend before the simulator is connected.

It draws a plain test card (the MVP space outlines, no vehicles, labelled TEST
PATTERN) and sends it as JPEG frames through the canonical frame contract. It is
NOT the simulator and sends no ground truth.

    uv run python scripts/test_camera.py [--count 20] [--hz 2] [--api http://127.0.0.1:8400]

Reads PARKRIGHT_INGEST_TOKEN from the environment (or .env) if set.
"""

import argparse
import io
import json
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / "packages/shared/fixtures/mvp-facility.json").read_text())


def token() -> str | None:
    if os.environ.get("PARKRIGHT_INGEST_TOKEN"):
        return os.environ["PARKRIGHT_INGEST_TOKEN"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("PARKRIGHT_INGEST_TOKEN="):
                return line.split("=", 1)[1].strip() or None
    return None


def test_card(seq: int, size: tuple[int, int] = (640, 360)) -> bytes:
    img = Image.new("RGB", size, (70, 72, 76))
    draw = ImageDraw.Draw(img)
    w, h = size
    for space in FIXTURE["spaces"]:
        p = space["plan"]
        box = (p["x"] * w, p["y"] * h, (p["x"] + p["w"]) * w, (p["y"] + p["h"]) * h)
        draw.rectangle(box, outline=(230, 230, 230), width=2)
        draw.text((box[0] + 6, box[1] + 6), space["space_id"], fill=(230, 230, 230))
    draw.text((10, h - 20), f"TEST PATTERN - not the simulator - frame {seq}", fill=(255, 210, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=os.environ.get("PARKRIGHT_API_URL", "http://127.0.0.1:8400"))
    ap.add_argument("--camera", default=FIXTURE["cameras"][0]["camera_id"])
    ap.add_argument("--count", type=int, default=20, help="frames to send; 0 = forever")
    ap.add_argument("--hz", type=float, default=2.0)
    args = ap.parse_args()

    session = f"test-camera-{uuid.uuid4().hex[:8]}"
    headers = {"authorization": f"Bearer {t}"} if (t := token()) else {}
    started = time.monotonic()
    seq = 0
    with httpx.Client(base_url=args.api, headers=headers, timeout=10) as client:
        while args.count == 0 or seq < args.count:
            metadata = {
                "session_id": session,
                "camera_id": args.camera,
                "seq": seq,
                "sim_time_ms": int((time.monotonic() - started) * 1000),
                "captured_at": datetime.now(UTC).isoformat(),
            }
            res = client.post(
                f"/api/v1/cameras/{args.camera}/frames",
                data={"metadata": json.dumps(metadata)},
                files={"image": ("frame.jpg", test_card(seq), "image/jpeg")},
            )
            body = res.json()
            summary = body.get("outcome") or body.get("error", {}).get("code")
            print(f"seq {seq:>4}  HTTP {res.status_code}  {summary}  changed={body.get('changed', '-')}")
            seq += 1
            time.sleep(1 / args.hz)


if __name__ == "__main__":
    main()
