"""Active-illumination liveness challenge route (Flawless/Ultra blueprint Item 3).

Thin adapter, same discipline as biometrics.py: every decision lives in
app.services.liveness, which is why it can be tested without an HTTP server.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime
from app.obs.metrics import METRICS
from app.runtime import Runtime
from app.schemas import ERROR_RESPONSES, LivenessChallengeRequest, LivenessChallengeResponse

router = APIRouter(prefix="/v1", tags=["biometrics"])


@router.post(
    "/liveness/challenge",
    summary="Active-illumination liveness challenge (Item 3)",
    description=(
        "Checks whether 2-4 captured frames' color response correlates with the "
        "screen-flash colors the client reports having displayed. Returns a "
        "**decision**, not an exception, whenever the frames could be read: "
        "`passed` is the authoritative liveness result -- the client never "
        "self-reports pass/fail. Not ISO/IEC 30107-3 certified; a real, "
        "own-built heuristic signal, documented as such in docs/API.md."
    ),
    responses={200: {"model": LivenessChallengeResponse}, **ERROR_RESPONSES},
)
def liveness_challenge(
    payload: LivenessChallengeRequest,
    runtime: Runtime = Depends(get_runtime),
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = runtime.liveness_service.execute(
            user_ref=payload.user_ref,
            frames=[frame.model_dump() for frame in payload.frames],
        )
    except Exception:
        METRICS.incr("liveness.error")
        raise
    METRICS.incr("liveness.passed" if result["passed"] else "liveness.failed")
    METRICS.observe("liveness", (time.perf_counter() - started) * 1000.0)
    return result
