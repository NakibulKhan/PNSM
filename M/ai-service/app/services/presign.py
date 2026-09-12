"""Presigned upload and download URLs.

Keys are always constructed here from validated components.  A client-supplied
key would be a path-traversal and object-overwrite primitive: it would let one
employee write over another's reference photo.

Reference: blueprint section 08.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from app.config import Settings
from app.errors import PnsmError, ReasonCode
from app.storage import keys as keymod
from app.storage.s3 import ObjectStore

log = logging.getLogger(__name__)

Purpose = Literal["reference", "checkin"]


class PresignService:
    """Mint short-lived URLs for direct-to-bucket transfer."""

    def __init__(self, store: ObjectStore, settings: Settings) -> None:
        self._store = store
        self._settings = settings

    def presign_put(
        self,
        *,
        user_ref: str,
        purpose: Purpose,
        object_id: str,
        content_type: str,
        content_length: int,
    ) -> dict[str, Any]:
        keymod.validate_user_ref(user_ref)
        keymod.validate_ulid(object_id)

        if not isinstance(content_length, int) or content_length <= 0:
            raise PnsmError(ReasonCode.BAD_REQUEST, detail="content_length must be a positive integer")
        if content_length > self._settings.max_upload_bytes:
            raise PnsmError(
                ReasonCode.PAYLOAD_TOO_LARGE,
                detail=(
                    f"content_length {content_length} exceeds the "
                    f"{self._settings.max_upload_bytes}-byte ceiling"
                ),
            )

        if purpose == "reference":
            key = keymod.reference_key(user_ref, object_id, content_type)
        elif purpose == "checkin":
            key = keymod.checkin_key(user_ref, object_id, content_type)
        else:
            raise PnsmError(ReasonCode.BAD_REQUEST, detail="purpose must be 'reference' or 'checkin'")

        signed = self._store.presign_put(
            key,
            content_type=content_type,
            content_length=content_length,
            ttl_s=self._settings.presign_put_ttl_s,
        )
        log.info("presigned put user_ref=%s purpose=%s key=%s bytes=%d", user_ref, purpose, key, content_length)
        return signed

    def presign_get(self, *, object_key: str) -> dict[str, Any]:
        keymod.require_managed_key(object_key)
        return self._store.presign_get(object_key, ttl_s=self._settings.presign_get_ttl_s)
