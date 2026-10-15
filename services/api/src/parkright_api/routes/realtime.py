"""WS /api/v1/realtime?facility_id=…

On connect: one `facility_snapshot`. Then an `occupancy_update` after every accepted
frame and whenever evidence goes stale. Each update carries every space, so clients
replace their state. If the socket drops, show every space as UNCERTAIN until it
reconnects and receives a fresh snapshot."""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from parkright_contracts import FacilitySnapshotMessage

from ..deps import now

router = APIRouter()

POLICY_VIOLATION = 1008


@router.websocket("/realtime")
async def realtime(websocket: WebSocket, facility_id: str) -> None:
    facility = websocket.app.state.registry.get(facility_id)
    await websocket.accept()
    if facility is None:
        await websocket.close(code=POLICY_VIOLATION, reason="unknown facility")
        return
    hub = websocket.app.state.hub
    queue = hub.subscribe(facility_id)
    try:
        t = now()
        await websocket.send_text(FacilitySnapshotMessage(facility=facility.facility(t), spaces=facility.spaces(t)).model_dump_json())

        async def pump() -> None:
            while True:
                await websocket.send_text(await queue.get())

        async def drain() -> None:
            # Clients do not need to send anything; reading notices disconnects.
            while True:
                await websocket.receive_text()

        tasks = [asyncio.create_task(pump()), asyncio.create_task(drain())]
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                await task
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(facility_id, queue)
