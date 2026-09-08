"""Request and response models.

Request models are enforced by FastAPI.  Response models are attached for
documentation only -- via ``responses={200: {"model": ...}}`` rather than
``response_model=`` -- because ``response_model`` silently *filters* fields that
are not declared, and a silently truncated response is worse than a loud
mismatch.  The contract tests validate real responses against the generated
OpenAPI schema instead, which catches drift in both directions.

Reference: blueprint section 03.
"""

from __future__ import annotations

import datetime as _dt
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

USER_REF = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
ULID = Annotated[str, Field(min_length=26, max_length=26, pattern=r"^[0-9A-HJKMNP-TV-Z]{26}$")]
CONTENT_TYPE = Literal["image/webp", "image/jpeg"]


class Strict(BaseModel):
    """Base for request bodies: unknown fields are a contract violation.

    Rejecting extras is deliberate. A typo'd field name that is silently
    ignored is exactly how a security flag like ``is_mock_location`` ends up
    never being read.
    """

    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------- inputs
class ImageRefModel(Strict):
    kind: Literal["s3_key", "r2_key", "base64"] = Field(
        description="'s3_key' for an object already uploaded to the bucket; "
        "'base64' for inline bytes (development and tests). 'r2_key' is the "
        "pre-AWS spelling of 's3_key', still accepted during the migration."
    )
    value: str = Field(min_length=1, max_length=1_400_000, description="Object key or base64 payload.")


class EnvelopeModel(BaseModel):
    """The encrypted embedding, exactly as returned by /v1/embed.

    ``extra='allow'`` on purpose: Person 3 stores this verbatim in MongoDB and
    may hand it back with driver-added metadata attached. Unknown keys are
    ignored rather than rejected, so a future envelope field does not break
    older readers.
    """

    model_config = ConfigDict(extra="allow")

    v: int = Field(description="Envelope schema version. 1 = static key, 2 = key provider aware.")
    kp: str | None = Field(
        default=None,
        description="Key provider that sealed this envelope: 'kms' or 'static'. Absent on v1.",
    )
    kv: str = Field(min_length=1, max_length=256, description="Key id or version used to encrypt.")
    dek: str | None = Field(
        default=None,
        description="Base64 KMS-wrapped data encryption key. Present only under the 'kms' provider.",
    )
    alg: str = Field(description="Always 'AES-256-GCM'.")
    iv: str = Field(description="Base64 96-bit nonce.")
    ct: str = Field(description="Base64 ciphertext.")
    tag: str = Field(description="Base64 128-bit GCM authentication tag.")
    model_version: str = Field(description="Model that produced the vector.")
    created_at: str | None = Field(default=None, description="RFC 3339 timestamp.")


class DeviceModel(Strict):
    platform: Literal["android", "ios", "web", "unknown"] = "unknown"
    os_version: str = Field(default="", max_length=32)
    app_version: str = Field(default="", max_length=32)
    is_mock_location: bool = Field(
        default=False, description="Android Location.isFromMockProvider() / iOS CLLocation.isSimulated."
    )
    is_emulator: bool = False
    is_rooted: bool = False


class EmbedRequest(Strict):
    user_ref: USER_REF
    image: ImageRefModel
    request_id: ULID


class VerifyRequest(Strict):
    user_ref: USER_REF
    image: ImageRefModel
    envelope: EnvelopeModel
    request_id: ULID
    captured_at: _dt.datetime = Field(description="RFC 3339 capture time from the device.")
    device: DeviceModel = Field(default_factory=DeviceModel)


LIVENESS_COLOR = Literal["red", "green", "blue", "white"]


class LivenessFrameModel(Strict):
    """One captured frame, timed to a screen-flash color the client displayed."""

    color: LIVENESS_COLOR
    image: ImageRefModel


class LivenessChallengeRequest(Strict):
    """Item 3 (Flawless/Ultra blueprint): active-illumination liveness.

    Not ISO/IEC 30107-3 certified -- that needs a real accredited lab. This is
    a genuine, own-built PAD signal: the client flashes 2-4 randomized screen
    colors and captures one frame per flash; this endpoint checks whether the
    frames' color response actually correlates with the reported flash.
    """

    user_ref: USER_REF
    request_id: ULID
    frames: list[LivenessFrameModel] = Field(min_length=2, max_length=4)


class PinHashRequest(Strict):
    user_ref: USER_REF
    pin: str = Field(min_length=1, max_length=32)


class PinVerifyRequest(Strict):
    user_ref: USER_REF
    pin: str = Field(min_length=1, max_length=32)
    pin_hash: str = Field(min_length=1, max_length=128)


class PresignPutRequest(Strict):
    user_ref: USER_REF
    purpose: Literal["reference", "checkin"]
    object_id: ULID
    content_type: CONTENT_TYPE
    content_length: int = Field(gt=0, le=5_242_880)


class PresignGetRequest(Strict):
    object_key: str = Field(min_length=1, max_length=512)


# -------------------------------------------------------------------- outputs
class QualityModel(BaseModel):
    det_score: float
    blur_var: float
    face_area_ratio: float
    brightness: float
    faces_found: int


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_s: float


class ReadyResponse(BaseModel):
    status: str
    model_version: str
    calibration_version: str
    preprocess_fingerprint: str
    storage: str
    warm: bool
    thresholds: dict[str, Any]
    warnings: list[str]
    security: dict[str, Any] = Field(
        description="Key provider, decision band model, and the applied response-header policy."
    )
    aws: dict[str, Any] = Field(
        description="Region, bucket, and the measured bucket encryption and public-access posture."
    )


class StorageTargetModel(BaseModel):
    """Where Person 3 persists the envelope."""

    collection: str = Field(description="Always 'FaceEmbeddings' -- never the Users document.")
    link_field: str = Field(description="Field on that document linking back to the employee.")


class EmbedResponse(BaseModel):
    ok: bool
    envelope: EnvelopeModel
    storage_target: StorageTargetModel
    quality: QualityModel
    warnings: list[str]
    model_version: str
    timings_ms: dict[str, float]


class PassivePadModel(BaseModel):
    """Item 3b (Flawless/Ultra blueprint): moire/edge-sharpness heuristics.

    A real but uncertified PAD signal (classical CV, not a trained model, not
    ISO/IEC 30107-3 certified) -- see app/ai/passive_pad.py. Recorded
    alongside the match, never used alone to reject a check-in.
    """

    moire_energy_ratio: float = Field(ge=0, le=1, description="Higher is more suspicious (periodic screen/print pattern).")
    edge_sharpness: float = Field(ge=0, description="Laplacian variance; very low suggests a soft print or replay.")
    confidence: float = Field(ge=0, le=100, description="Combined heuristic score. Not a certified detection rate.")


class VerifyResponse(BaseModel):
    decision: Literal["approved", "flagged", "rejected"]
    confidence: float = Field(ge=0, le=100, description="Calibrated confidence, the FR-07 number.")
    raw_cosine: float = Field(ge=-1, le=1, description="Audit trail. Never shown to employees.")
    threshold: dict[str, Any]
    reason_code: str
    hr_alert: bool = Field(
        description="True when Person 3 should push a WebSocket alert to the HR dashboard."
    )
    quality: QualityModel
    passive_pad: PassivePadModel
    model_version: str
    image_hash: str
    capture_skew_s: float
    latency_ms: dict[str, float]


class LivenessChallengeResponse(BaseModel):
    passed: bool
    confidence: float = Field(ge=0, le=100, description="Mean per-frame color-correlation score. Not a certified detection rate.")
    per_frame_scores: list[float] = Field(description="One 0-100 correlation score per submitted frame, in the order sent.")


class PinHashResponse(BaseModel):
    pin_hash: str
    algo: str
    cost: int
    pepper_version: str


class PinVerifyResponse(BaseModel):
    match: bool
    locked: bool
    attempts_left: int
    retry_after_s: int


class PresignPutResponse(BaseModel):
    upload_url: str
    method: str
    headers: dict[str, str]
    object_key: str
    expires_at: str
    max_bytes: int


class PresignGetResponse(BaseModel):
    download_url: str
    method: str
    object_key: str
    expires_at: str


class ErrorBody(BaseModel):
    code: str = Field(description="A member of the reason-code table.")
    message: str = Field(description="Safe to show an end user.")
    retryable: bool
    request_id: str | None = None
    context: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


#: Attached to every route so the reason-code table appears in the OpenAPI doc.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "BAD_REQUEST"},
    401: {"model": ErrorResponse, "description": "UNAUTHORIZED - bad or missing HMAC signature"},
    403: {"model": ErrorResponse, "description": "MOCK_LOCATION or EMULATOR_DETECTED"},
    409: {"model": ErrorResponse, "description": "REPLAY_DETECTED, STALE_CAPTURE, MODEL_VERSION_MISMATCH, NO_REFERENCE_EMBEDDING"},
    413: {"model": ErrorResponse, "description": "PAYLOAD_TOO_LARGE"},
    422: {"model": ErrorResponse, "description": "Quality gate failure or malformed body"},
    429: {"model": ErrorResponse, "description": "RATE_LIMITED"},
    500: {"model": ErrorResponse, "description": "DECRYPT_FAILED or INTERNAL"},
    502: {"model": ErrorResponse, "description": "UPSTREAM_STORAGE_ERROR"},
}
