"""ASGI middleware, driven end to end.

The middleware in :mod:`app.middleware` is raw ASGI and touches no FastAPI at
all, so it can be exercised against a bare Starlette app.  That matters: the
body-drain-and-replay in :class:`HmacAuthMiddleware` is the single most
dangerous piece of code in this service.  It reads the request body *before*
the route handler in order to verify a signature over it, then has to hand that
same body onward -- and if the replay is wrong, every request arrives at the
handler with an empty body and nothing raises.

These tests prove the body actually survives the round trip.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import httpx
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.crypto import hmac_auth
from app.middleware import REQUEST_ID_HEADER, HmacAuthMiddleware, RequestContextMiddleware

SECRET = base64.b64decode("BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=")
MAX_BODY = 4096


async def _echo(request):
    """Echo what actually reached the handler, plus the correlation id."""
    raw = await request.body()
    return JSONResponse(
        {
            "received_bytes": len(raw),
            "received_body": raw.decode("utf-8", "replace"),
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
        }
    )


def build_app(*, enabled: bool = True, max_body: int = MAX_BODY, exempt=("/health",)):
    inner = Starlette(
        routes=[
            Route("/v1/echo", _echo, methods=["POST"]),
            Route("/health", _echo, methods=["GET", "POST"]),
        ]
    )
    wrapped = HmacAuthMiddleware(
        inner,
        secret_provider=lambda: SECRET,
        max_skew_s=300,
        max_body_bytes=max_body,
        enabled=enabled,
        exempt_paths=exempt,
    )
    return RequestContextMiddleware(wrapped)


def call(
    app: Any,
    path: str = "/v1/echo",
    payload: dict | None = None,
    *,
    sign: bool = True,
    headers: dict[str, str] | None = None,
    method: str = "POST",
    raw_body: bytes | None = None,
) -> httpx.Response:
    """Drive the ASGI app synchronously so these tests need no async plugin."""

    async def _run() -> httpx.Response:
        body = raw_body if raw_body is not None else json.dumps(payload or {}).encode()
        request_headers = {"Content-Type": "application/json"}
        if sign:
            timestamp = hmac_auth.current_timestamp()
            request_headers[hmac_auth.TIMESTAMP_HEADER] = timestamp
            request_headers[hmac_auth.SIGNATURE_HEADER] = hmac_auth.sign(SECRET, timestamp, body)
        request_headers.update(headers or {})
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            if method == "GET":
                return await client.get(path, headers=request_headers)
            return await client.post(path, content=body, headers=request_headers)

    return asyncio.run(_run())


# ------------------------------------------------------------------ the body
def test_the_body_survives_the_signature_check() -> None:
    """The whole point. Drain, verify, replay -- and the handler still sees it."""
    payload = {"user_ref": "alice", "note": "x" * 500}
    encoded = json.dumps(payload).encode()

    response = call(build_app(), payload=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["received_bytes"] == len(encoded)
    assert json.loads(body["received_body"]) == payload


def test_an_empty_body_is_replayed_correctly() -> None:
    response = call(build_app(), raw_body=b"")
    assert response.status_code == 200
    assert response.json()["received_bytes"] == 0


def test_a_body_at_the_size_limit_is_accepted() -> None:
    body = b'{"pad":"' + b"y" * (MAX_BODY - 20) + b'"}'
    assert len(body) <= MAX_BODY
    response = call(build_app(), raw_body=body)
    assert response.status_code == 200
    assert response.json()["received_bytes"] == len(body)


def test_an_oversized_body_is_refused_without_being_buffered() -> None:
    body = b'{"pad":"' + b"z" * (MAX_BODY * 3) + b'"}'
    response = call(build_app(), raw_body=body)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


# ------------------------------------------------------------------- signing
def test_a_correctly_signed_request_passes() -> None:
    assert call(build_app(), payload={"a": 1}).status_code == 200


def test_an_unsigned_request_is_refused() -> None:
    response = call(build_app(), payload={"a": 1}, sign=False)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_a_body_altered_after_signing_is_refused() -> None:
    """The attack the signature exists to stop."""

    async def _run() -> httpx.Response:
        honest = json.dumps({"user_ref": "alice"}).encode()
        tampered = json.dumps({"user_ref": "attacker"}).encode()
        timestamp = hmac_auth.current_timestamp()
        headers = {
            "Content-Type": "application/json",
            hmac_auth.TIMESTAMP_HEADER: timestamp,
            # Signature computed over the honest body, sent with the tampered one.
            hmac_auth.SIGNATURE_HEADER: hmac_auth.sign(SECRET, timestamp, honest),
        }
        transport = httpx.ASGITransport(app=build_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/v1/echo", content=tampered, headers=headers)

    response = asyncio.run(_run())
    assert response.status_code == 401


def test_a_stale_timestamp_is_refused() -> None:
    import time

    stale = str(int(time.time()) - 100_000)
    body = b"{}"
    response = call(
        build_app(),
        raw_body=body,
        sign=False,
        headers={
            hmac_auth.TIMESTAMP_HEADER: stale,
            hmac_auth.SIGNATURE_HEADER: hmac_auth.sign(SECRET, stale, body),
        },
    )
    assert response.status_code == 401


def test_authentication_can_be_disabled_for_local_development() -> None:
    response = call(build_app(enabled=False), payload={"a": 1}, sign=False)
    assert response.status_code == 200
    assert response.json()["received_body"] == '{"a": 1}'


# ------------------------------------------------------------------- exempt
def test_exempt_paths_need_no_signature() -> None:
    """A cron monitor must reach /health without credentials."""
    response = call(build_app(), path="/health", method="GET", sign=False)
    assert response.status_code == 200


def test_exempt_matching_does_not_leak_to_similar_paths() -> None:
    """'/health' must not exempt '/healthcheck-admin' or similar."""
    app = build_app(exempt=("/health",))
    inner = Starlette(routes=[Route("/healthz", _echo, methods=["POST"])])
    guarded = RequestContextMiddleware(
        HmacAuthMiddleware(
            inner,
            secret_provider=lambda: SECRET,
            max_skew_s=300,
            max_body_bytes=MAX_BODY,
            enabled=True,
            exempt_paths=("/health",),
        )
    )
    assert call(guarded, path="/healthz", payload={}, sign=False).status_code == 401
    assert call(app, path="/health", payload={}, sign=False).status_code == 200


# --------------------------------------------------------------- request id
def test_every_response_carries_a_request_id_header() -> None:
    response = call(build_app(), payload={"a": 1})
    assert response.headers.get(REQUEST_ID_HEADER)


def test_the_handler_sees_the_same_request_id_as_the_header() -> None:
    response = call(build_app(), payload={"a": 1})
    assert response.json()["request_id"] == response.headers[REQUEST_ID_HEADER]


def test_an_inbound_request_id_is_honoured() -> None:
    """So a trace can be followed across Person 3's service and this one."""
    response = call(build_app(), payload={"a": 1}, headers={REQUEST_ID_HEADER: "trace-abc-123"})
    assert response.headers[REQUEST_ID_HEADER] == "trace-abc-123"
    assert response.json()["request_id"] == "trace-abc-123"


def test_rejections_also_carry_the_request_id() -> None:
    """An error a caller reports must be findable in our logs."""
    response = call(build_app(), payload={"a": 1}, sign=False, headers={REQUEST_ID_HEADER: "trace-xyz"})
    assert response.status_code == 401
    assert response.json()["error"]["request_id"] == "trace-xyz"


def test_request_ids_are_unique_per_request() -> None:
    seen = {call(build_app(), payload={"a": 1}).headers[REQUEST_ID_HEADER] for _ in range(20)}
    assert len(seen) == 20


# ------------------------------------------------------------------ shape
def test_a_rejection_uses_the_standard_error_envelope() -> None:
    body = call(build_app(), payload={"a": 1}, sign=False).json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "retryable", "request_id"}


def test_no_internal_detail_leaks_in_a_rejection() -> None:
    body = call(build_app(), payload={"a": 1}, sign=False).json()
    text = json.dumps(body).lower()
    for leak in ("signature mismatch", "skew", "secret", "hmac", "traceback"):
        assert leak not in text, f"rejection leaked {leak!r}: {body}"
