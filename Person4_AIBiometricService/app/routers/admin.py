"""Operator-only routes.

Guarded by ``PNSM_ADMIN_TOKEN`` in addition to the HMAC signature, because
these change the service's decision behaviour at runtime.

Reference: blueprint sections 04 and 10.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime, require_admin
from app.runtime import Runtime
from app.schemas import ERROR_RESPONSES

router = APIRouter(prefix="/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post(
    "/recalibrate",
    summary="Reload calibration.json without restarting",
    description=(
        "Re-reads the calibration file and swaps it in atomically. Lets a threshold be "
        "corrected during a demo instead of forcing a redeploy and another cold start.\n\n"
        "The preprocessing fingerprint is re-checked: a calibration fitted on a different "
        "pipeline is refused rather than silently accepted."
    ),
    responses=ERROR_RESPONSES,
)
def recalibrate(runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    return runtime.reload_calibration()


@router.post(
    "/warmup",
    summary="Force a warmup inference",
    description="Run one synthetic inference so the next real check-in does not pay first-call cost.",
    responses=ERROR_RESPONSES,
)
def warmup(runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    return runtime.warmup()
