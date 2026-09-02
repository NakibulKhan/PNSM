"""Presigned upload and download routes.

Reference: blueprint section 08.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.deps import get_runtime
from app.obs.metrics import METRICS
from app.runtime import Runtime
from app.schemas import (
    ERROR_RESPONSES,
    PresignGetRequest,
    PresignGetResponse,
    PresignPutRequest,
    PresignPutResponse,
)

router = APIRouter(prefix="/v1/storage", tags=["storage"])


@router.post(
    "/presign-put",
    summary="Short-lived direct-to-bucket upload URL",
    description=(
        "The object key is built server-side from `user_ref`, `purpose` and `object_id`; "
        "a client-supplied key is never accepted.\n\n"
        "`content_type` **and the exact `content_length`** are signed into the URL, so the "
        "bucket itself rejects a mismatched or oversized upload. Send the compressed byte "
        "length you are about to upload, not an estimate."
    ),
    responses={200: {"model": PresignPutResponse}, **ERROR_RESPONSES},
)
def presign_put(payload: PresignPutRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    result = runtime.presign_service.presign_put(
        user_ref=payload.user_ref,
        purpose=payload.purpose,
        object_id=payload.object_id,
        content_type=payload.content_type,
        content_length=payload.content_length,
    )
    METRICS.incr("presign.put")
    return result


@router.post(
    "/presign-get",
    summary="Short-lived read URL for the HR audit view",
    description="Only keys inside a managed prefix are signed. Traversal attempts are rejected.",
    responses={200: {"model": PresignGetResponse}, **ERROR_RESPONSES},
)
def presign_get(payload: PresignGetRequest, runtime: Runtime = Depends(get_runtime)) -> dict[str, Any]:
    result = runtime.presign_service.presign_get(object_key=payload.object_key)
    METRICS.incr("presign.get")
    return result
