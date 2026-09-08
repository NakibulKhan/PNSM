"""FastAPI application factory.

The application is assembled here and nowhere else.  A single exception handler
turns every enumerated failure into the error envelope from
:mod:`app.errors`, so no route ever constructs an error response by hand and no
two endpoints can drift into different shapes.

Reference: blueprint sections 02 and 03.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings, get_settings
from app.crypto import hmac_auth
from app.errors import PnsmError, ReasonCode
from app.logging_setup import configure_logging
from app.middleware import HmacAuthMiddleware, RequestContextMiddleware
from app.obs.metrics import METRICS
from app.routers import admin, biometrics, health, liveness, security, storage
from app.runtime import Runtime
from app.security.headers import SecurityHeadersMiddleware

log = logging.getLogger(__name__)

DESCRIPTION = """
AI biometrics, cryptography and cloud DevOps service for the **PNSM Workforce
Attendance & Management System** (CSE482L, Group 8). Owned by Person 4.

This service is the only component that ever holds a plaintext face embedding
or the field-encryption key. Person 3's backend calls it over HTTP and stores
the opaque envelope it returns.

**Authentication.** Every route except `/health`, `/ready` and this
documentation requires two headers:

```
X-PNSM-Timestamp: <unix seconds>
X-PNSM-Signature: v1=<hex HMAC-SHA256 of "timestamp.body">
```

**Confidence is calibrated.** `confidence` is not `cosine * 100`. ArcFace does
not put genuine pairs above 0.85 raw cosine, so a raw threshold would reject
nearly every real employee. See `docs/CALIBRATION.md`.
"""

TAGS_METADATA = [
    {"name": "ops", "description": "Liveness, readiness and metrics."},
    {"name": "biometrics", "description": "Enrolment and 1:1 verification."},
    {"name": "security", "description": "PIN hashing and verification with lockout."},
    {"name": "storage", "description": "Presigned direct-to-bucket transfer."},
    {"name": "admin", "description": "Operator-only. Requires `X-PNSM-Admin`."},
]

EXEMPT_PATHS = ("/health", "/ready", "/docs", "/redoc", "/openapi.json")


def _error_response(error: PnsmError, request: Request) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    if error.spec.security_event:
        log.warning(
            "security event code=%s path=%s detail=%s",
            error.code.value,
            request.url.path,
            error.detail,
        )
        METRICS.incr(f"security.{error.code.value}")
    return JSONResponse(error.envelope(request_id), status_code=error.http_status)


def register_handlers(app: FastAPI) -> None:
    @app.exception_handler(PnsmError)
    async def _pnsm(request: Request, exc: PnsmError) -> JSONResponse:
        if exc.detail:
            log.info("handled code=%s detail=%s", exc.code.value, exc.detail)
        METRICS.incr(f"reason.{exc.code.value}")
        return _error_response(exc, request)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI's default 422 body has a different shape from our envelope.
        # Normalising it here is what lets Person 1 and Person 2 write exactly
        # one error path instead of two.
        fields = [".".join(str(p) for p in err.get("loc", ())[1:]) for err in exc.errors()]
        error = PnsmError(
            ReasonCode.BAD_REQUEST,
            detail=f"request validation failed: {exc.errors()}",
            extra={"fields": [f for f in fields if f][:12]},
        )
        METRICS.incr("reason.BAD_REQUEST")
        return _error_response(error, request)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ReasonCode.BAD_REQUEST if exc.status_code < 500 else ReasonCode.INTERNAL
        if exc.status_code == 404:
            return JSONResponse(
                {
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "No such endpoint.",
                        "retryable": False,
                        "request_id": getattr(request.state, "request_id", None),
                    }
                },
                status_code=404,
            )
        return _error_response(PnsmError(code, detail=str(exc.detail)), request)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Anything reaching here is a bug. Log the traceback; return nothing
        # that could help an attacker map the internals.
        log.exception("unhandled error path=%s", request.url.path)
        METRICS.incr("reason.INTERNAL")
        return _error_response(PnsmError(ReasonCode.INTERNAL), request)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. Safe to call more than once (tests do)."""
    resolved = settings or get_settings()
    configure_logging(resolved.log_level, json_output=resolved.app_env != "local")

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        runtime = Runtime(resolved)
        application.state.runtime = runtime
        log.info(
            "starting pnsm-ai-svc version=%s env=%s model=%s calibration=%s",
            resolved.service_version,
            resolved.app_env,
            runtime.engine.model_version,
            runtime.calibration().calibration_version,
        )
        runtime.warmup()
        yield
        log.info("shutting down after %.0fs", runtime.uptime_s)

    app = FastAPI(
        title="PNSM AI, Security & DevOps Service",
        version=resolved.service_version,
        description=DESCRIPTION,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        contact={"name": "Person 4 - AI, Security & DevOps", "email": "pnsm.team@nsu.edu.bd"},
    )

    # Order matters: the last middleware added is the outermost. So the
    # security headers wrap everything -- including a 401 produced by the HMAC
    # layer, which is exactly the response an attacker sees most often -- and
    # the request id exists before anything can reject a request.
    app.add_middleware(
        HmacAuthMiddleware,
        secret_provider=lambda: resolved.hmac_secret,
        max_skew_s=resolved.hmac_max_skew_s,
        # Base64 inflates by 4/3; the header allowance covers JSON overhead.
        max_body_bytes=(resolved.max_upload_bytes * 4) // 3 + 65_536,
        enabled=resolved.auth_required,
        exempt_paths=EXEMPT_PATHS,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        SecurityHeadersMiddleware,
        csp=resolved.csp_policy,
        hsts_max_age_s=resolved.hsts_max_age_s,
        enabled=resolved.security_headers_enabled,
    )

    register_handlers(app)
    app.include_router(health.router)
    app.include_router(biometrics.router)
    app.include_router(liveness.router)
    app.include_router(security.router)
    app.include_router(storage.router)
    app.include_router(admin.router)
    return app


def sign_for(body: bytes, secret: bytes) -> dict[str, str]:
    """Helper for clients and smoke tests: build the two auth headers."""
    timestamp = hmac_auth.current_timestamp()
    return {
        hmac_auth.TIMESTAMP_HEADER: timestamp,
        hmac_auth.SIGNATURE_HEADER: hmac_auth.sign(secret, timestamp, body),
    }


#: The ASGI application uvicorn serves: ``uvicorn app.main:app``.
#:
#: Building it at import time is cheap and deliberate. ``create_app`` only wires
#: routes and reads settings; the expensive work -- ONNX sessions, calibration,
#: warmup -- happens inside the lifespan, so a missing environment variable
#: surfaces when the server starts rather than when a linter imports the file.
app = create_app()
