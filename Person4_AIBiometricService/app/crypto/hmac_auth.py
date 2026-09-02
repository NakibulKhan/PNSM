"""Service-to-service request authentication.

Only Person 3's backend may call this service.  Every request carries a
timestamp and an HMAC-SHA256 signature over ``timestamp + "." + raw_body``.
Signing the timestamp alongside the body is what makes the freshness window
meaningful: an attacker cannot lift a valid signature and replay it with a
newer timestamp.

Reference: blueprint section 03.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Final

from app.errors import PnsmError, ReasonCode

TIMESTAMP_HEADER: Final[str] = "X-PNSM-Timestamp"
SIGNATURE_HEADER: Final[str] = "X-PNSM-Signature"
SIGNATURE_PREFIX: Final[str] = "v1="


def signing_payload(timestamp: str, body: bytes) -> bytes:
    """Exact bytes that get signed. Person 3 must reproduce this precisely."""
    return timestamp.encode("ascii") + b"." + body


def sign(secret: bytes, timestamp: str, body: bytes) -> str:
    """Produce the value for :data:`SIGNATURE_HEADER`."""
    digest = hmac.new(secret, signing_payload(timestamp, body), hashlib.sha256).hexdigest()
    return f"{SIGNATURE_PREFIX}{digest}"


def verify(
    secret: bytes,
    *,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    max_skew_s: int,
    now: float | None = None,
) -> None:
    """Validate a signed request, or raise ``UNAUTHORIZED``.

    Every failure returns the same reason code and the same message. The
    ``detail`` differentiates them for our logs only -- telling a caller
    *which* check failed hands an attacker a free oracle.
    """
    if not timestamp or not signature:
        raise PnsmError(ReasonCode.UNAUTHORIZED, detail="missing signature headers")

    try:
        ts = int(timestamp)
    except (TypeError, ValueError) as exc:
        raise PnsmError(ReasonCode.UNAUTHORIZED, detail="timestamp is not an integer") from exc

    current = time.time() if now is None else now
    skew = abs(current - ts)
    if skew > max_skew_s:
        raise PnsmError(
            ReasonCode.UNAUTHORIZED, detail=f"timestamp skew {skew:.0f}s exceeds {max_skew_s}s"
        )

    if not signature.startswith(SIGNATURE_PREFIX):
        raise PnsmError(ReasonCode.UNAUTHORIZED, detail="signature is missing the v1= prefix")

    expected = sign(secret, timestamp, body)
    # compare_digest on the full header value, including the prefix.
    if not hmac.compare_digest(expected, signature):
        raise PnsmError(ReasonCode.UNAUTHORIZED, detail="signature mismatch")


def current_timestamp() -> str:
    """Helper for clients and tests."""
    return str(int(time.time()))
