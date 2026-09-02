"""Liveness, readiness and metrics.

``/health`` is deliberately cheap -- no model call, no network, no lock -- and
unauthenticated, because the container HEALTHCHECK, the ECS health check and any
external uptime monitor all have to reach it without credentials.  A probe that
cost inference time would compete with the check-ins it exists to protect.

Reference: blueprint sections 03 and 10.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime, require_admin
from app.obs.metrics import METRICS
from app.runtime import Runtime
from app.schemas import HealthResponse, ReadyResponse

router = APIRouter(tags=["ops"])


@router.get(
    "/health",
    summary="Liveness probe",
    description=(
        "Cheap liveness check used by the container HEALTHCHECK, the ECS health "
        "check and any external uptime monitor. Never touches the model."
    ),
    responses={200: {"model": HealthResponse}},
)
def health(runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    return runtime.health()


@router.get(
    "/ready",
    summary="Readiness probe",
    description="Reports model, calibration and warmup state. Use this before a demo.",
    responses={200: {"model": ReadyResponse}},
)
def ready(runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    return runtime.ready()


@router.get(
    "/metrics",
    summary="Counters, latency summary and resident memory",
    description="Operator-only. Used by the CI memory gate.",
    dependencies=[Depends(require_admin)],
)
def metrics() -> dict[str, Any]:
    return METRICS.snapshot()
