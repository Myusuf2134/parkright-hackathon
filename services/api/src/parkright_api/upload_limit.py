"""Caps request body size for upload routes before any multipart parsing happens.

Pure ASGI: rejects on Content-Length up front, and counts streamed bytes for
chunked uploads, so an oversized frame never reaches memory in full."""

import re
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from .errors import ApiError

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


class BodyTooLarge(ApiError):
    def __init__(self, limit: int) -> None:
        super().__init__(413, "payload_too_large", f"Request body exceeds {limit} bytes")


class UploadLimitMiddleware:
    def __init__(self, app: ASGIApp, path_pattern: str, max_bytes: int) -> None:
        self.app, self.pattern, self.max_bytes = app, re.compile(path_pattern), max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.pattern.fullmatch(scope["path"]):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            return await _reject(send, self.max_bytes)

        seen = 0

        async def limited() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    raise BodyTooLarge(self.max_bytes)
            return message

        await self.app(scope, limited, send)


async def _reject(send: Send, limit: int) -> None:
    body = f'{{"error":{{"code":"payload_too_large","message":"Request body exceeds {limit} bytes"}}}}'.encode()
    await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})
