"""Object key construction and validation.

Keys are built server-side and never accepted verbatim from a client.  A
client-supplied key is a path-traversal and object-overwrite primitive: it
would let one employee write over another's reference photo, or read a key
outside the intended prefix.

Reference: blueprint section 08.
"""

from __future__ import annotations

import datetime as _dt
import re
from typing import Final

from app.errors import PnsmError, ReasonCode

REF_PREFIX: Final[str] = "refs"
CHECKIN_PREFIX: Final[str] = "checkins"

#: Employee identifiers are Mongo ObjectId strings today, but the service
#: treats them as opaque; this only bounds the shape so they are safe in a key.
_USER_REF_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_ULID_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

#: Only these content types may be uploaded, and only these extensions written.
CONTENT_TYPES: Final[dict[str, str]] = {
    "image/webp": "webp",
    "image/jpeg": "jpg",
}


class KeyError_(ValueError):
    """Invalid key component."""


def validate_user_ref(user_ref: str) -> str:
    if not isinstance(user_ref, str) or not _USER_REF_RE.match(user_ref):
        raise PnsmError(
            ReasonCode.BAD_REQUEST,
            detail="user_ref must be 1-64 characters of [A-Za-z0-9_-]",
        )
    return user_ref


def validate_ulid(value: str, field: str = "object_id") -> str:
    if not isinstance(value, str) or not _ULID_RE.match(value):
        raise PnsmError(ReasonCode.BAD_REQUEST, detail=f"{field} must be a 26-character ULID")
    return value


def extension_for(content_type: str) -> str:
    try:
        return CONTENT_TYPES[content_type]
    except KeyError as exc:
        raise PnsmError(
            ReasonCode.BAD_REQUEST,
            detail=f"content_type must be one of {sorted(CONTENT_TYPES)}",
        ) from exc


def reference_key(user_ref: str, object_id: str, content_type: str) -> str:
    """``refs/{user_ref}/{ulid}.{ext}``"""
    validate_user_ref(user_ref)
    validate_ulid(object_id)
    return f"{REF_PREFIX}/{user_ref}/{object_id}.{extension_for(content_type)}"


def checkin_key(
    user_ref: str,
    object_id: str,
    content_type: str,
    *,
    when: _dt.datetime | None = None,
) -> str:
    """``checkins/{yyyy}/{mm}/{dd}/{user_ref}/{ulid}.{ext}``

    Date-partitioned so the 90-day lifecycle rule can be expressed as a prefix
    and so a day's check-ins can be listed without scanning the bucket.
    """
    validate_user_ref(user_ref)
    validate_ulid(object_id)
    stamp = (when or _dt.datetime.now(_dt.UTC)).astimezone(_dt.UTC)
    return (
        f"{CHECKIN_PREFIX}/{stamp:%Y/%m/%d}/{user_ref}/"
        f"{object_id}.{extension_for(content_type)}"
    )


def is_managed_key(key: str) -> bool:
    """True when a key looks like one this service produced.

    Used to reject a caller-supplied key that points somewhere unexpected --
    including any attempt at ``..`` traversal or an absolute path.
    """
    if not isinstance(key, str) or not key or len(key) > 512:
        return False
    if key.startswith("/") or ".." in key or "//" in key or "\\" in key:
        return False
    if not key.startswith((f"{REF_PREFIX}/", f"{CHECKIN_PREFIX}/")):
        return False
    return bool(re.match(r"^[A-Za-z0-9_\-/.]+$", key))


def require_managed_key(key: str) -> str:
    if not is_managed_key(key):
        raise PnsmError(
            ReasonCode.BAD_REQUEST,
            detail="object key is not within a managed prefix",
        )
    return key
