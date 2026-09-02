"""Enrolment and verification routes (FR-01, FR-05, FR-07).

Thin adapters. Every decision lives in :mod:`app.services`, which is why those
can be tested without an HTTP server.

Reference: blueprint section 03.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime
from app.obs.metrics import METRICS
from app.runtime import Runtime
from app.schemas import (
    ERROR_RESPONSES,
    EmbedRequest,
    EmbedResponse,
    VerifyRequest,
    VerifyResponse,
)
from app.security.guards import DeviceContext
from app.services.image_source import ImageRef

router = APIRouter(prefix="/v1", tags=["biometrics"])


@router.post(
    "/embed",
    summary="Generate an encrypted reference embedding (FR-01)",
    description=(
        "Takes an onboarding photograph and returns the face embedding **already "
        "encrypted**. Store the `envelope` object verbatim on the employee document; "
        "do not reformat it, and do not attempt to read it -- the key never leaves "
        "this service.\n\n"
        "Quality metrics are returned so the onboarding form can reject a poor photo "
        "at capture time, while it can still be retaken."
    ),
    responses={200: {"model": EmbedResponse}, **ERROR_RESPONSES},
)
def embed(
    payload: EmbedRequest,
    runtime: Runtime = Depends(get_runtime),
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = runtime.enroll_service.execute(
            user_ref=payload.user_ref,
            image=ImageRef(kind=payload.image.kind, value=payload.image.value),
            request_id=payload.request_id,
        )
    except Exception:
        METRICS.incr("embed.error")
        raise
    METRICS.incr("embed.ok")
    METRICS.observe("embed", (time.perf_counter() - started) * 1000.0)
    return result


@router.post(
    "/verify",
    summary="1:1 face verification for a check-in (FR-05, FR-07)",
    description=(
        "The hot path. Returns a **decision**, not an exception, whenever a comparison "
        "actually completed: `approved` at or above the approve band, `flagged` between "
        "the bands, `rejected` below.\n\n"
        "`confidence` is the FR-07 number and is a *calibrated* function of cosine "
        "similarity, not `cosine * 100` -- see `docs/CALIBRATION.md`. `raw_cosine` is "
        "the audit trail and should never be shown to an employee.\n\n"
        "Device flags, capture freshness, request-id reuse and image reuse are all "
        "checked before any inference runs."
    ),
    responses={200: {"model": VerifyResponse}, **ERROR_RESPONSES},
)
def verify(
    payload: VerifyRequest,
    runtime: Runtime = Depends(get_runtime),
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = runtime.verify_service.execute(
            user_ref=payload.user_ref,
            image=ImageRef(kind=payload.image.kind, value=payload.image.value),
            # exclude_none so an optional field Person 3 did not send does not
            # arrive at the crypto layer as an explicit null. fle handles that
            # case too; not creating it is the cheaper of the two defences.
            envelope=payload.envelope.model_dump(exclude_none=True),
            request_id=payload.request_id,
            captured_at=payload.captured_at,
            device=DeviceContext(**payload.device.model_dump()),
        )
    except Exception:
        METRICS.incr("verify.error")
        raise
    METRICS.incr(f"verify.{result['decision']}")
    METRICS.observe("verify", (time.perf_counter() - started) * 1000.0)
    return result
