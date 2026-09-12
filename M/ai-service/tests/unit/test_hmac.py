"""Service-to-service signature verification."""

from __future__ import annotations

import base64
import time

import pytest

from app.crypto import hmac_auth
from app.errors import PnsmError, ReasonCode

SECRET = base64.b64decode(base64.b64encode(b"\x04" * 32))
BODY = b'{"user_ref":"u1"}'


def _now() -> str:
    return str(int(time.time()))


def test_a_correctly_signed_request_is_accepted() -> None:
    timestamp = _now()
    signature = hmac_auth.sign(SECRET, timestamp, BODY)
    hmac_auth.verify(
        SECRET, timestamp=timestamp, signature=signature, body=BODY, max_skew_s=300
    )


def test_signature_covers_the_body() -> None:
    timestamp = _now()
    signature = hmac_auth.sign(SECRET, timestamp, BODY)
    with pytest.raises(PnsmError) as caught:
        hmac_auth.verify(
            SECRET, timestamp=timestamp, signature=signature, body=BODY + b" ", max_skew_s=300
        )
    assert caught.value.code is ReasonCode.UNAUTHORIZED


def test_signature_covers_the_timestamp() -> None:
    """Otherwise an attacker could replay a captured signature with a fresh time."""
    timestamp = _now()
    signature = hmac_auth.sign(SECRET, timestamp, BODY)
    with pytest.raises(PnsmError):
        hmac_auth.verify(
            SECRET,
            timestamp=str(int(timestamp) + 1),
            signature=signature,
            body=BODY,
            max_skew_s=300,
        )


def test_a_stale_timestamp_is_rejected() -> None:
    stale = str(int(time.time()) - 10_000)
    signature = hmac_auth.sign(SECRET, stale, BODY)
    with pytest.raises(PnsmError):
        hmac_auth.verify(SECRET, timestamp=stale, signature=signature, body=BODY, max_skew_s=300)


def test_a_far_future_timestamp_is_rejected() -> None:
    ahead = str(int(time.time()) + 10_000)
    signature = hmac_auth.sign(SECRET, ahead, BODY)
    with pytest.raises(PnsmError):
        hmac_auth.verify(SECRET, timestamp=ahead, signature=signature, body=BODY, max_skew_s=300)


def test_a_different_secret_is_rejected() -> None:
    timestamp = _now()
    signature = hmac_auth.sign(b"\x09" * 32, timestamp, BODY)
    with pytest.raises(PnsmError):
        hmac_auth.verify(
            SECRET, timestamp=timestamp, signature=signature, body=BODY, max_skew_s=300
        )


def test_missing_headers_are_rejected() -> None:
    with pytest.raises(PnsmError):
        hmac_auth.verify(SECRET, timestamp=None, signature=None, body=BODY, max_skew_s=300)
    with pytest.raises(PnsmError):
        hmac_auth.verify(SECRET, timestamp=_now(), signature=None, body=BODY, max_skew_s=300)


def test_a_missing_version_prefix_is_rejected() -> None:
    timestamp = _now()
    signature = hmac_auth.sign(SECRET, timestamp, BODY)
    with pytest.raises(PnsmError):
        hmac_auth.verify(
            SECRET,
            timestamp=timestamp,
            signature=signature.removeprefix("v1="),
            body=BODY,
            max_skew_s=300,
        )


def test_a_non_numeric_timestamp_is_rejected() -> None:
    with pytest.raises(PnsmError):
        hmac_auth.verify(
            SECRET, timestamp="not-a-number", signature="v1=abc", body=BODY, max_skew_s=300
        )


def test_every_rejection_returns_the_same_message() -> None:
    """The detail differentiates failures for our logs; the caller sees one
    message, so the endpoint is not an oracle for which check failed."""
    messages = set()
    for kwargs in (
        {"timestamp": None, "signature": None},
        {"timestamp": _now(), "signature": "v1=" + "0" * 64},
        {"timestamp": "0", "signature": "v1=" + "0" * 64},
    ):
        try:
            hmac_auth.verify(SECRET, body=BODY, max_skew_s=300, **kwargs)
        except PnsmError as exc:
            messages.add(exc.envelope()["error"]["message"])
    assert len(messages) == 1


def test_signing_payload_is_exactly_timestamp_dot_body() -> None:
    """Person 3 must reproduce this byte-for-byte; pin the format down."""
    assert hmac_auth.signing_payload("123", b"{}") == b"123.{}"
