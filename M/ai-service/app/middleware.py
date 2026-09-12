"""ASGI middleware: request identity, body limits and HMAC authentication.

Written as raw ASGI rather than ``BaseHTTPMiddleware`` because the signature
covers the request body, and the body must be read *before* the route handler
and then replayed to it.  ``BaseHTTPMiddleware`` consumes the stream in a way
the downstream ``Request`` cannot recover from; replacing the ``receive``
callable is the correct pattern.

Reference: blueprint section 03.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterable
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.crypto import hmac_auth
from app.errors import PnsmError, ReasonCode

log = logging.getLogger(__name__)

REQUEST_ID_HEADER = "x-request-id"


class RequestContextMiddleware:
    """Attach a correlation id to every request and echo it back."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        request_id = headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        scope.setdefault("state", {})
        scope["state"]["request_id"] = request_id

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                raw = list(message.get("headers", []))
                raw.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message = {**message, "headers": raw}
            await send(message)

        await self.app(scope, receive, send_with_header)


async def _drain(receive: Receive, *, limit: int) -> tuple[bytes, bool]:
    """Read the whole request body. Returns ``(body, exceeded_limit)``."""
    chunks: list[bytes] = []
    total = 0
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            return b"".join(chunks), False
        chunk = message.get("body", b"")
        total += len(chunk)
        if total > limit:
            # Keep draining so the connection is not left half-read, but stop
            # accumulating: an oversized body must never be buffered in full.
            while message.get("more_body", False):
                message = await receive()
                if message["type"] == "http.disconnect":
                    break
            return b"", True
        chunks.append(chunk)
        if not message.get("more_body", False):
            return b"".join(chunks), False


def _replayer(body: bytes) -> Receive:
    """A ``receive`` that yields the buffered body once, then disconnects."""
    sent = False

    async def receive() -> Message:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return receive


class HmacAuthMiddleware:
    """Reject any request not signed by Person 3's backend.

    Exempt paths are the ones a cron monitor and a browser doc viewer must
    reach unauthenticated: ``/health``, ``/ready``, and the OpenAPI surface.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        secret_provider: Callable[[], bytes],
        max_skew_s: int,
        max_body_bytes: int,
        enabled: bool = True,
        exempt_paths: Iterable[str] = (),
    ) -> None:
        self.app = app
        self._secret_provider = secret_provider
        self._max_skew_s = max_skew_s
        self._max_body_bytes = max_body_bytes
        self._enabled = enabled
        self._exempt = tuple(exempt_paths)

    def _is_exempt(self, path: str) -> bool:
        return any(path == p or path.startswith(p.rstrip("/") + "/") for p in self._exempt)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self._is_exempt(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        request_id = (scope.get("state") or {}).get("request_id")
        body, too_large = await _drain(receive, limit=self._max_body_bytes)
        if too_large:
            await self._reject(
                scope, send, PnsmError(ReasonCode.PAYLOAD_TOO_LARGE, detail="request body too large"), request_id
            )
            return

        if self._enabled:
            headers = {
                k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
            }
            try:
                hmac_auth.verify(
                    self._secret_provider(),
                    timestamp=headers.get(hmac_auth.TIMESTAMP_HEADER.lower()),
                    signature=headers.get(hmac_auth.SIGNATURE_HEADER.lower()),
                    body=body,
                    max_skew_s=self._max_skew_s,
                )
            except PnsmError as exc:
                log.warning(
                    "rejected unsigned request path=%s detail=%s", scope.get("path"), exc.detail
                )
                await self._reject(scope, send, exc, request_id)
                return

        await self.app(scope, _replayer(body), send)

    @staticmethod
    async def _reject(scope: Scope, send: Send, error: PnsmError, request_id: Any) -> None:
        response = JSONResponse(
            error.envelope(request_id), status_code=error.http_status
        )
        await response(scope, _replayer(b""), send)
