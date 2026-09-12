"""Enrolment use case (FR-01).

Takes a reference photograph, extracts a 512-dimension embedding, and returns
it **already encrypted**.  Person 3 stores the envelope verbatim and never
holds a plaintext biometric vector -- the encryption boundary lives entirely
inside this service.

Reference: blueprint sections 01 and 03.
"""

from __future__ import annotations

import logging
from typing import Any

from app.ai.engine import FaceEngine
from app.ai.quality import warnings_for
from app.config import Settings
from app.crypto import fle
from app.crypto.keyproviders import KeyProvider
from app.services.image_source import ImageRef, resolve
from app.storage import keys as keymod
from app.storage.s3 import ObjectStore

log = logging.getLogger(__name__)


class EnrollService:
    """Reference photo -> encrypted embedding envelope."""

    def __init__(
        self,
        engine: FaceEngine,
        store: ObjectStore,
        settings: Settings,
        key_provider: KeyProvider,
    ) -> None:
        self._engine = engine
        self._store = store
        self._settings = settings
        self._keys = key_provider

    def execute(self, *, user_ref: str, image: ImageRef, request_id: str) -> dict[str, Any]:
        keymod.validate_user_ref(user_ref)

        payload = resolve(image, self._store, max_bytes=self._settings.max_upload_bytes)
        # Enrolment holds the higher quality bar: a poor reference photo
        # degrades every future check-in for this employee.
        result = self._engine.extract(payload, enrolment=True)

        envelope = fle.seal(
            result.vector,
            user_ref=user_ref,
            model_version=self._engine.model_version,
            provider=self._keys,
        )

        log.info(
            "enrolled user_ref=%s request_id=%s det=%.3f blur=%.1f key_provider=%s "
            "envelope_bytes=%d",
            user_ref,
            request_id,
            result.quality.det_score,
            result.quality.blur_var,
            self._keys.name,
            fle.envelope_size_bytes(envelope),
        )

        return {
            "ok": True,
            "envelope": envelope,
            # Person 3 writes this into the FaceEmbeddings collection, not onto
            # the Users document. See docs/INTEGRATION.md.
            "storage_target": {"collection": "FaceEmbeddings", "link_field": "user_id"},
            "quality": result.quality.as_dict(),
            "warnings": warnings_for(result.quality, self._settings),
            "model_version": self._engine.model_version,
            "timings_ms": {k: round(v, 1) for k, v in result.timings_ms.items()},
        }
