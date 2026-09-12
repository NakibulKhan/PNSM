"""PIN routes (FR-06).

Reference: blueprint section 06.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime
from app.obs.metrics import METRICS
from app.runtime import Runtime
from app.schemas import (
    ERROR_RESPONSES,
    PinHashRequest,
    PinHashResponse,
    PinVerifyRequest,
    PinVerifyResponse,
)

router = APIRouter(prefix="/v1/security", tags=["security"])


@router.post(
    "/pin/hash",
    summary="Hash a new employee PIN",
    description=(
        "Applies the server-side pepper, then bcrypt. Store the returned record on the "
        "employee document. Policy violations (too short, too common, sequential, "
        "repeated) come back as `BAD_REQUEST` with a message written for the HR user."
    ),
    responses={200: {"model": PinHashResponse}, **ERROR_RESPONSES},
)
def pin_hash(payload: PinHashRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    result = runtime.pin_service.hash_pin(user_ref=payload.user_ref, pin=payload.pin)
    METRICS.incr("pin.hash")
    return result


@router.post(
    "/pin/verify",
    summary="Check a submitted PIN, enforcing lockout",
    description=(
        "A wrong PIN is a normal outcome and returns `200` with `match: false` plus the "
        "remaining attempt budget. Once the budget is spent the account locks and further "
        "attempts return `429 RATE_LIMITED` **without** performing a comparison."
    ),
    responses={200: {"model": PinVerifyResponse}, **ERROR_RESPONSES},
)
def pin_verify(payload: PinVerifyRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    result = runtime.pin_service.verify_pin(
        user_ref=payload.user_ref, pin=payload.pin, pin_hash=payload.pin_hash
    )
    METRICS.incr("pin.match" if result["match"] else "pin.mismatch")
    return result
