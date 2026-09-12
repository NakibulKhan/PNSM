#!/usr/bin/env python3
"""A stand-in for Person 3's backend, so Persons 1 and 2 are never blocked.

Speaks the endpoints the mobile app and the dashboard expect, signs its calls
to the real AI service, and keeps everything else in memory.  It is *not* a
substitute for Person 3's work -- there is no MongoDB, no geofence maths, no
JWT, no WebSocket -- but it is enough to build a camera screen or an onboarding
form against on day one.

    docker compose up            # starts this alongside the AI service
    python scripts/mock_api.py   # or run it directly on port 8010

Endpoints (all unauthenticated, deliberately -- this is a development tool):

    GET  /mock/health
    POST /mock/employees              onboard, returns employee_id
    GET  /mock/employees
    POST /mock/upload-url             presigned PUT for the mobile client
    POST /mock/check-in               the full check-in path
    GET  /mock/attendance             everything recorded so far
    POST /mock/reset
"""

from __future__ import annotations

import datetime as _dt
import os
import secrets
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

sys.path.insert(0, str(REPO_ROOT / "clients" / "python"))
from pnsm_ai_client import PnsmAiClient, PnsmAiError, new_ulid  # noqa: E402

AI_URL = os.environ.get("PNSM_AI_URL", "http://localhost:8000")
HMAC_SECRET = os.environ.get("PNSM_HMAC_SECRET", "")

app = FastAPI(
    title="PNSM Mock Backend (stands in for Person 3)",
    description=__doc__,
    version="0.1.0",
)

#: In-memory stand-ins for the MongoDB collections Person 3 will build.
EMPLOYEES: dict[str, dict[str, Any]] = {}
ATTENDANCE: list[dict[str, Any]] = []


def client() -> PnsmAiClient:
    if not HMAC_SECRET:
        raise RuntimeError("PNSM_HMAC_SECRET is not set; the mock cannot call the AI service")
    return PnsmAiClient(base_url=AI_URL, hmac_secret=HMAC_SECRET)


class OnboardRequest(BaseModel):
    name: str
    image_base64: str
    pin: str = "418362"


class UploadUrlRequest(BaseModel):
    employee_id: str
    content_length: int
    content_type: str = "image/webp"
    purpose: str = "checkin"


class CheckInRequest(BaseModel):
    employee_id: str
    image_base64: str | None = None
    object_key: str | None = None
    pin: str | None = None
    platform: str = "android"
    is_mock_location: bool = False
    is_emulator: bool = False


@app.get("/mock/health")
async def health() -> dict[str, Any]:
    try:
        async with client() as ai:
            upstream = await ai.health()
    except Exception as exc:
        upstream = {"error": str(exc)}
    return {"status": "ok", "ai_service": upstream, "employees": len(EMPLOYEES)}


@app.post("/mock/employees")
async def onboard(payload: OnboardRequest) -> Any:
    """Person 2's onboarding form calls this."""
    employee_id = secrets.token_hex(12)
    try:
        async with client() as ai:
            enrolled = await ai.embed(
                user_ref=employee_id,
                image={"kind": "base64", "value": payload.image_base64},
            )
            pin_record = await ai.hash_pin(user_ref=employee_id, pin=payload.pin)
    except PnsmAiError as exc:
        return JSONResponse(
            {"error": {"code": exc.code, "message": str(exc)}}, status_code=exc.status or 502
        )

    EMPLOYEES[employee_id] = {
        "employee_id": employee_id,
        "name": payload.name,
        # In Person 3's real schema this lives in FaceEmbeddings, linked by
        # user_id -- never on the Users document. Flattened here only because
        # this mock keeps everything in one dict.
        # subdocument on the Users document. Stored verbatim, never read.
        "envelope": enrolled["envelope"],
        "pin_hash": pin_record["pin_hash"],
        "created_at": _dt.datetime.now(_dt.UTC).isoformat(),
    }
    return {
        "employee_id": employee_id,
        "name": payload.name,
        "quality": enrolled["quality"],
        "warnings": enrolled["warnings"],
    }


@app.get("/mock/employees")
async def list_employees() -> dict[str, Any]:
    return {
        "employees": [
            {"employee_id": e["employee_id"], "name": e["name"], "created_at": e["created_at"]}
            for e in EMPLOYEES.values()
        ]
    }


@app.post("/mock/upload-url")
async def upload_url(payload: UploadUrlRequest) -> Any:
    try:
        async with client() as ai:
            return await ai.presign_put(
                user_ref=payload.employee_id,
                purpose=payload.purpose,  # type: ignore[arg-type]
                object_id=new_ulid(),
                content_type=payload.content_type,  # type: ignore[arg-type]
                content_length=payload.content_length,
            )
    except PnsmAiError as exc:
        return JSONResponse(
            {"error": {"code": exc.code, "message": str(exc)}}, status_code=exc.status or 502
        )


@app.post("/mock/check-in")
async def check_in(payload: CheckInRequest) -> Any:
    """The path Person 1's app calls. Mirrors what Person 3 will build."""
    employee = EMPLOYEES.get(payload.employee_id)
    if employee is None:
        return JSONResponse(
            {"error": {"code": "NOT_FOUND", "message": "Unknown employee."}}, status_code=404
        )

    if payload.object_key:
        image = {"kind": "s3_key", "value": payload.object_key}
    elif payload.image_base64:
        image = {"kind": "base64", "value": payload.image_base64}
    else:
        return JSONResponse(
            {"error": {"code": "BAD_REQUEST", "message": "Send image_base64 or object_key."}},
            status_code=400,
        )

    started = time.perf_counter()
    try:
        async with client() as ai:
            if payload.pin is not None:
                pin_result = await ai.verify_pin(
                    user_ref=payload.employee_id, pin=payload.pin, pin_hash=employee["pin_hash"]
                )
                if not pin_result["match"]:
                    return JSONResponse(
                        {
                            "error": {
                                "code": "PIN_MISMATCH",
                                "message": "Incorrect PIN.",
                                "attempts_left": pin_result["attempts_left"],
                            }
                        },
                        status_code=401,
                    )

            # Person 3's real implementation runs the geofence query here,
            # between the PIN check and the face comparison.
            result = await ai.verify(
                user_ref=payload.employee_id,
                image=image,
                envelope=employee["envelope"],
                request_id=new_ulid(),
                captured_at=_dt.datetime.now(_dt.UTC),
                device={
                    "platform": payload.platform,
                    "is_mock_location": payload.is_mock_location,
                    "is_emulator": payload.is_emulator,
                },
            )
    except PnsmAiError as exc:
        return JSONResponse(
            {"error": {"code": exc.code, "message": str(exc), "retryable": exc.retryable}},
            status_code=exc.status or 502,
        )

    record = {
        "log_id": secrets.token_hex(8),
        "employee_id": payload.employee_id,
        "name": employee["name"],
        "check_type": "check_in",
        "timestamp": _dt.datetime.now(_dt.UTC).isoformat(),
        "face_match_score": result["confidence"],
        "status": {"approved": "approved", "flagged": "flagged", "rejected": "rejected"}[
            result["decision"]
        ],
        "reason_code": result["reason_code"],
        "round_trip_ms": round((time.perf_counter() - started) * 1000.0, 1),
    }
    if result["decision"] != "rejected":
        ATTENDANCE.append(record)
    return record


@app.get("/mock/attendance")
async def attendance() -> dict[str, Any]:
    return {"logs": list(reversed(ATTENDANCE)), "count": len(ATTENDANCE)}


@app.post("/mock/reset")
async def reset() -> dict[str, str]:
    EMPLOYEES.clear()
    ATTENDANCE.clear()
    return {"status": "cleared"}


if __name__ == "__main__":
    import uvicorn

    if not HMAC_SECRET:
        print("PNSM_HMAC_SECRET is not set. Generate one with scripts/gen_keys.py.")
        print("The mock will start, but every call to the AI service will fail.")
    print(f"Mock backend on http://localhost:8010  ->  AI service at {AI_URL}")
    print("Interactive docs: http://localhost:8010/docs")
    uvicorn.run(app, host="0.0.0.0", port=8010)
