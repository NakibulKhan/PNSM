"""FastAPI dependencies."""

from __future__ import annotations

import hmac

from fastapi import Header, Request

from app.errors import PnsmError, ReasonCode
from app.runtime import Runtime


def get_runtime(request: Request) -> Runtime:
    """The application's composition root, built once at startup."""
    runtime = getattr(request.app.state, "runtime", None)
    if runtime is None:  # pragma: no cover - only reachable if lifespan failed
        raise PnsmError(ReasonCode.INTERNAL, detail="runtime is not initialised")
    return runtime


def get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "") or ""


def require_admin(request: Request, x_pnsm_admin: str = Header(default="")) -> None:
    """Second factor for operator-only routes, on top of the HMAC signature.

    An unset ``PNSM_ADMIN_TOKEN`` closes the route entirely rather than opening
    it: a blank shared secret must never mean "no check".
    """
    runtime = get_runtime(request)
    expected = runtime.settings.admin_token
    if not expected:
        raise PnsmError(
            ReasonCode.UNAUTHORIZED, detail="PNSM_ADMIN_TOKEN is not configured; admin routes are closed"
        )
    if not hmac.compare_digest(expected, x_pnsm_admin or ""):
        raise PnsmError(ReasonCode.UNAUTHORIZED, detail="admin token mismatch")
