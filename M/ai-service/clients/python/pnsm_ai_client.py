"""PNSM AI service client for Person 3's Python/FastAPI backend.

Copy this file into your project.  Depends only on ``httpx``.  The signing
logic here is the reference implementation: sign requests any other way and
they come back 401.

    from pnsm_ai_client import PnsmAiClient, PnsmAiError, new_ulid

    ai = PnsmAiClient(
        base_url=os.environ["PNSM_AI_URL"],
        hmac_secret=os.environ["PNSM_HMAC_SECRET"],
    )

    result = await ai.verify(
        user_ref=str(user["_id"]),
        image={"kind": "s3_key", "value": object_key},
        envelope=face_doc["envelope"],   # from the FaceEmbeddings collection
        request_id=new_ulid(),
        captured_at=payload.captured_at,
        device=payload.device,
    )
    if result["decision"] == "approved":
        ...

Owner: Person 4. The contract lives in docs/API.md.
"""

from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import hmac
import json
import os
import secrets
import time
from collections.abc import Mapping
from typing import Any, Literal

import httpx

ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class PnsmAiError(Exception):
    """Any non-2xx response. Carries the service's reason code."""

    def __init__(self, status: int, body: Mapping[str, Any] | None = None) -> None:
        error = dict((body or {}).get("error") or {})
        super().__init__(error.get("message") or f"PNSM AI service returned {status}")
        self.status = status
        #: A member of the reason-code table in docs/API.md. Branch on this.
        self.code: str = error.get("code", "INTERNAL")
        #: True when retrying the identical request could succeed.
        self.retryable: bool = bool(error.get("retryable"))
        self.request_id: str | None = error.get("request_id")
        self.context: dict[str, Any] | None = error.get("context")


def new_ulid() -> str:
    """A Crockford base32 ULID.

    Use a fresh one per genuine check-in: it is both the idempotency key and
    the replay guard. Reuse it only when retrying the *identical* request.
    """
    milliseconds = int(time.time() * 1000)
    time_part = ""
    for _ in range(10):
        time_part = ULID_ALPHABET[milliseconds % 32] + time_part
        milliseconds //= 32
    random_part = "".join(secrets.choice(ULID_ALPHABET) for _ in range(16))
    return time_part + random_part


class PnsmAiClient:
    """Async client. Construct once and reuse -- it holds a connection pool."""

    def __init__(
        self,
        *,
        base_url: str,
        hmac_secret: str,
        admin_token: str = "",
        timeout_s: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._secret = base64.b64decode(hmac_secret)
        if len(self._secret) != 32:
            raise ValueError(f"hmac_secret must decode to 32 bytes, got {len(self._secret)}")
        self._admin_token = admin_token
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout_s)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> PnsmAiClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    # ---------------------------------------------------------------- signing
    def _headers(self, body: bytes, *, admin: bool = False) -> dict[str, str]:
        """The signed payload is ``f"{timestamp}.{raw_body}"``.

        The timestamp is inside the signature so a captured signature cannot be
        replayed with a fresh time. Sign the exact bytes you send -- re-encoding
        the JSON changes them and invalidates the signature.
        """
        timestamp = str(int(time.time()))
        digest = hmac.new(
            self._secret, timestamp.encode("ascii") + b"." + body, hashlib.sha256
        ).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-PNSM-Timestamp": timestamp,
            "X-PNSM-Signature": f"v1={digest}",
        }
        if admin and self._admin_token:
            headers["X-PNSM-Admin"] = self._admin_token
        return headers

    async def _post(self, path: str, payload: dict[str, Any], *, admin: bool = False) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        try:
            response = await self._client.post(path, content=body, headers=self._headers(body, admin=admin))
        except httpx.HTTPError as exc:
            # Surface transport failures in the same shape as everything else
            # so callers need exactly one error path.
            raise PnsmAiError(
                0,
                {"error": {"code": "UPSTREAM_STORAGE_ERROR", "message": str(exc), "retryable": True}},
            ) from exc
        return self._unwrap(response)

    async def _get(self, path: str, *, admin: bool = False) -> dict[str, Any]:
        response = await self._client.get(path, headers=self._headers(b"", admin=admin))
        return self._unwrap(response)

    @staticmethod
    def _unwrap(response: httpx.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code >= 400:
            raise PnsmAiError(response.status_code, body)
        return body

    # -------------------------------------------------------------------- ops
    async def health(self) -> dict[str, Any]:
        return self._unwrap(await self._client.get("/health"))

    async def ready(self) -> dict[str, Any]:
        return self._unwrap(await self._client.get("/ready"))

    # ------------------------------------------------------------- biometrics
    async def embed(
        self, *, user_ref: str, image: Mapping[str, str], request_id: str | None = None
    ) -> dict[str, Any]:
        """Onboarding (FR-01).

        Store ``result["envelope"]`` verbatim on the employee document. Do not
        reformat it and do not try to read it: the key never leaves the AI
        service, which is what keeps a bug in your code from leaking biometrics.
        """
        return await self._post(
            "/v1/embed",
            {"user_ref": user_ref, "image": dict(image), "request_id": request_id or new_ulid()},
        )

    async def verify(
        self,
        *,
        user_ref: str,
        image: Mapping[str, str],
        envelope: Mapping[str, Any],
        request_id: str,
        captured_at: _dt.datetime | str,
        device: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Check-in (FR-05, FR-07).

        Returns a decision whenever a comparison completed: ``approved``,
        ``rejected``, or -- only when the service runs the three-band policy --
        ``flagged``. Anything else raises :class:`PnsmAiError`; branch on
        ``err.code``.

        **Push the HR alert off ``result["hr_alert"]``, not off the decision
        string.** It is true for anything short of a clean approval under either
        band policy, so the alerting keeps working if the policy changes.

        ``confidence`` is the calibrated similarity score as a percentage --
        not ``cosine * 100``. ``raw_cosine`` is the audit trail and must never
        be shown to an employee.

        Pass the device flags through unchanged. They are the FR-05 control,
        and a field you forget to forward is a check the service cannot make.
        """
        stamp = captured_at.isoformat() if isinstance(captured_at, _dt.datetime) else captured_at
        supplied = dict(device or {})
        return await self._post(
            "/v1/verify",
            {
                "user_ref": user_ref,
                "image": dict(image),
                "envelope": dict(envelope),
                "request_id": request_id,
                "captured_at": stamp,
                "device": {
                    "platform": supplied.get("platform", "unknown"),
                    "os_version": supplied.get("os_version", ""),
                    "app_version": supplied.get("app_version", ""),
                    "is_mock_location": bool(supplied.get("is_mock_location", False)),
                    "is_emulator": bool(supplied.get("is_emulator", False)),
                    "is_rooted": bool(supplied.get("is_rooted", False)),
                },
            },
        )

    # ----------------------------------------------------------------- security
    async def hash_pin(self, *, user_ref: str, pin: str) -> dict[str, Any]:
        return await self._post("/v1/security/pin/hash", {"user_ref": user_ref, "pin": pin})

    async def verify_pin(self, *, user_ref: str, pin: str, pin_hash: str) -> dict[str, Any]:
        return await self._post(
            "/v1/security/pin/verify",
            {"user_ref": user_ref, "pin": pin, "pin_hash": pin_hash},
        )

    # ------------------------------------------------------------------ storage
    async def presign_put(
        self,
        *,
        user_ref: str,
        purpose: Literal["reference", "checkin"],
        object_id: str,
        content_type: Literal["image/webp", "image/jpeg"],
        content_length: int,
    ) -> dict[str, Any]:
        """``content_length`` must be the exact compressed byte count.

        It is signed into the URL, so the bucket itself rejects a mismatch --
        the size ceiling is enforced by infrastructure, not by client goodwill.
        """
        return await self._post(
            "/v1/storage/presign-put",
            {
                "user_ref": user_ref,
                "purpose": purpose,
                "object_id": object_id,
                "content_type": content_type,
                "content_length": content_length,
            },
        )

    async def presign_get(self, *, object_key: str) -> dict[str, Any]:
        return await self._post("/v1/storage/presign-get", {"object_key": object_key})

    # -------------------------------------------------------------------- admin
    async def recalibrate(self) -> dict[str, Any]:
        return await self._post("/v1/admin/recalibrate", {}, admin=True)

    async def metrics(self) -> dict[str, Any]:
        return await self._get("/metrics", admin=True)


def from_environment() -> PnsmAiClient:
    """Build a client from ``PNSM_AI_URL`` / ``PNSM_HMAC_SECRET``."""
    return PnsmAiClient(
        base_url=os.environ["PNSM_AI_URL"],
        hmac_secret=os.environ["PNSM_HMAC_SECRET"],
        admin_token=os.environ.get("PNSM_ADMIN_TOKEN", ""),
    )
