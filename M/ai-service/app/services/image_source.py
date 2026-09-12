"""Resolving an image reference into bytes.

Two forms are accepted.  ``s3_key`` is the normal path: the mobile client
uploaded directly to the bucket with a presigned URL and Person 3 forwards only
the key.  ``base64`` exists for local development, integration tests, and the
case where Person 3 already holds the bytes -- it is bounded by the same size
ceiling, so it cannot be used to smuggle a large payload past the guard.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Any, Literal

from app.errors import PnsmError, ReasonCode
from app.storage import keys as keymod
from app.storage.s3 import ObjectStore

ImageKind = Literal["s3_key", "r2_key", "base64"]

#: ``r2_key`` is the pre-AWS spelling. It is still accepted so that a client
#: coded against the earlier contract keeps working through the migration, and
#: means exactly the same thing. New code should send ``s3_key``.
OBJECT_KINDS: tuple[str, ...] = ("s3_key", "r2_key")
VALID_KINDS: tuple[str, ...] = (*OBJECT_KINDS, "base64")


@dataclass(frozen=True)
class ImageRef:
    """A pointer to image bytes."""

    kind: ImageKind
    value: str

    @property
    def is_object_key(self) -> bool:
        return self.kind in OBJECT_KINDS

    @classmethod
    def parse(cls, payload: Any) -> ImageRef:
        if not isinstance(payload, dict):
            raise PnsmError(ReasonCode.BAD_REQUEST, detail="image must be an object")
        kind = payload.get("kind")
        value = payload.get("value")
        if kind not in VALID_KINDS:
            raise PnsmError(
                ReasonCode.BAD_REQUEST,
                detail=f"image.kind must be one of {list(VALID_KINDS)}",
            )
        if not isinstance(value, str) or not value:
            raise PnsmError(ReasonCode.BAD_REQUEST, detail="image.value must be a non-empty string")
        return cls(kind=kind, value=value)  # type: ignore[arg-type]


def resolve(ref: ImageRef, store: ObjectStore, *, max_bytes: int) -> bytes:
    """Fetch the bytes an :class:`ImageRef` points at."""
    if ref.is_object_key:
        keymod.require_managed_key(ref.value)
        return store.get_object(ref.value, max_bytes=max_bytes)

    # base64: reject on encoded length first, so a huge string is never decoded.
    # Base64 inflates by 4/3, so the encoded ceiling is that much larger.
    if len(ref.value) > (max_bytes * 4) // 3 + 16:
        raise PnsmError(
            ReasonCode.PAYLOAD_TOO_LARGE,
            detail=f"base64 payload exceeds the {max_bytes}-byte ceiling",
        )
    try:
        payload = base64.b64decode(ref.value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PnsmError(ReasonCode.BAD_REQUEST, detail="image.value is not valid base64") from exc
    if len(payload) > max_bytes:
        raise PnsmError(
            ReasonCode.PAYLOAD_TOO_LARGE,
            detail=f"decoded payload is {len(payload)} bytes, ceiling is {max_bytes}",
        )
    return payload
