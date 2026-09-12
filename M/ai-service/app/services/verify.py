"""Verification use case (FR-05, FR-07) -- the hot path.

The order of operations below is load-bearing.  Cheap, decisive checks run
first so that a spoofed or replayed request never reaches the model, and the
reference embedding is decrypted *before* the object fetch so a wrong key or a
re-enrolment requirement fails in microseconds rather than after a 200 ms round
trip to the bucket.

A completed comparison always returns HTTP 200 with a ``decision``.  A failure
to *perform* the comparison raises and becomes an error envelope.  Person 1 and
Person 2 branch on ``reason_code`` in both cases.

Reference: blueprint sections 03, 04, 07 and 11.
"""

from __future__ import annotations

import datetime as _dt
import logging
import time
from typing import Any

from app.ai import passive_pad
from app.ai.engine import FaceEngine
from app.ai.score import ScoreResult, decide
from app.config import Settings
from app.crypto import fle
from app.crypto.keyproviders import KeyProvider
from app.errors import PnsmError, ReasonCode
from app.security.guards import DeviceContext, SecurityGuards
from app.services.image_source import ImageRef, resolve
from app.storage import keys as keymod
from app.storage.s3 import ObjectStore

log = logging.getLogger(__name__)


class VerifyService:
    """Live selfie + stored envelope -> banded decision."""

    def __init__(
        self,
        engine: FaceEngine,
        store: ObjectStore,
        guards: SecurityGuards,
        settings: Settings,
        calibration_provider,  # Callable[[], Calibration]
        key_provider: KeyProvider,
    ) -> None:
        self._engine = engine
        self._store = store
        self._guards = guards
        self._settings = settings
        self._calibration_provider = calibration_provider
        self._keys = key_provider

    def execute(
        self,
        *,
        user_ref: str,
        image: ImageRef,
        envelope: dict[str, Any] | None,
        request_id: str,
        captured_at: _dt.datetime,
        device: DeviceContext,
        now: _dt.datetime | None = None,
    ) -> dict[str, Any]:
        started_total = time.perf_counter()
        timings: dict[str, float] = {}

        # 1. Shape. An unusable identifier is not worth any further work.
        keymod.validate_user_ref(user_ref)

        # 2. Rate limit, before anything that costs CPU or network.
        self._guards.check_rate(user_ref)

        # 3. Device integrity. Free, and decisive.
        self._guards.check_device(device)

        # 4. Freshness. Blocks a selfie captured hours ago somewhere else.
        skew_s = self._guards.check_freshness(captured_at, now=now)

        # 5. Nonce. Single-use request id; also makes retries idempotent.
        self._guards.check_request_id(request_id)

        # 6. Decrypt the reference from the FaceEmbeddings collection. Before
        #    the object fetch on purpose: a wrong key, a tampered envelope, or
        #    a stale model version costs microseconds here and 200+ ms if
        #    deferred until after the fetch. Under the KMS provider this is
        #    also where the data key is unwrapped, usually from cache.
        if not envelope:
            raise PnsmError(
                ReasonCode.NO_REFERENCE_EMBEDDING,
                detail=f"no stored embedding supplied for {user_ref}",
            )
        started = time.perf_counter()
        reference = fle.open_envelope(
            envelope,
            user_ref=user_ref,
            provider=self._keys,
            expected_model_version=self._engine.model_version,
        )
        timings["decrypt"] = (time.perf_counter() - started) * 1000.0

        # 7. Fetch the live selfie.
        started = time.perf_counter()
        payload = resolve(image, self._store, max_bytes=self._settings.max_upload_bytes)
        timings["fetch"] = (time.perf_counter() - started) * 1000.0

        # 8. Image replay. Catches the same saved photo resubmitted daily --
        #    an attack GPS, PIN and face match all pass cleanly.
        image_hash = self._guards.check_image_replay(user_ref, payload)

        # 9. Extract. The expensive step, reached only by a clean request.
        result = self._engine.extract(payload, enrolment=False)
        timings.update(result.timings_ms)

        # 9b. Passive PAD (Item 3b, Flawless/Ultra blueprint): moire/edge-
        #     sharpness heuristics, a real but uncertified signal recorded
        #     alongside the match -- never used alone to reject a check-in.
        #     Decodes the payload a second time (engine.decode() is cheap
        #     relative to the ONNX inference above) rather than threading a
        #     second return value through extract()'s well-tested internals.
        started = time.perf_counter()
        passive = passive_pad.analyze(self._engine.decode(payload), self._settings)
        timings["passive_pad"] = (time.perf_counter() - started) * 1000.0

        # 10. Score against the fitted calibration.
        started = time.perf_counter()
        scored: ScoreResult = decide(
            reference,
            result.vector,
            self._calibration_provider(),
            bands=self._settings.decision_bands,
        )
        timings["score"] = (time.perf_counter() - started) * 1000.0
        timings["total"] = (time.perf_counter() - started_total) * 1000.0

        log.info(
            "verify user_ref=%s request_id=%s decision=%s confidence=%.2f cosine=%.4f "
            "skew=%.0fs total=%.0fms",
            user_ref,
            request_id,
            scored.decision.value,
            scored.confidence,
            scored.raw_cosine,
            skew_s,
            timings["total"],
        )

        return {
            "decision": scored.decision.value,
            "confidence": scored.confidence,
            "raw_cosine": scored.raw_cosine,
            "threshold": scored.thresholds(),
            "reason_code": scored.reason_code.value,
            # The master plan routes "an instant WebSocket alert to the HR
            # dashboard for manual auditing" whenever a check-in does not
            # cleanly approve. Person 3 broadcasts on this flag.
            "hr_alert": scored.hr_alert,
            "quality": result.quality.as_dict(),
            "passive_pad": passive.as_dict(),
            "model_version": self._engine.model_version,
            "image_hash": image_hash,
            "capture_skew_s": round(skew_s, 1),
            "latency_ms": {k: round(v, 1) for k, v in timings.items()},
        }
