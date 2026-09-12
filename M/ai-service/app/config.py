"""Service configuration.

Every setting is read from the environment.  The service **fails to start**
rather than falling back to an insecure default: a missing encryption key or a
missing calibration file is a deployment error, and discovering it at boot is
far cheaper than discovering it during a check-in.

Reference: blueprint section 10 (environment variables).
"""

from __future__ import annotations

import base64
import binascii
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Length of every symmetric secret this service accepts, in bytes.
SECRET_LEN = 32
#: AES-256-GCM nonce length in bytes (96 bits -- GCM's optimal size).
GCM_IV_LEN = 12
#: AES-256-GCM authentication tag length in bytes (128 bits, full length).
GCM_TAG_LEN = 16
#: Dimensionality of an ArcFace embedding.
EMBEDDING_DIM = 512


class ConfigError(RuntimeError):
    """Raised at import/boot time when the environment is not usable."""


def _decode_secret(raw: str, name: str) -> bytes:
    try:
        value = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError) as exc:  # pragma: no cover - defensive
        raise ConfigError(f"{name} is not valid base64") from exc
    if len(value) != SECRET_LEN:
        raise ConfigError(f"{name} must decode to exactly {SECRET_LEN} bytes, got {len(value)}")
    return value


class Settings(BaseSettings):
    """Runtime settings.

    Aliases accept both the ``PNSM_``-prefixed name and the bare name used in
    the blueprint, so either spelling works in a deployment platform's UI.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        # Lets tests construct Settings(fle_keys_raw=...) by field name while
        # deployments keep using the environment aliases.
        populate_by_name=True,
    )

    # ---------------------------------------------------------------- runtime
    app_env: str = Field(default="local", validation_alias=AliasChoices("PNSM_APP_ENV", "APP_ENV"))
    log_level: str = Field(default="INFO", validation_alias=AliasChoices("PNSM_LOG_LEVEL", "LOG_LEVEL"))
    service_version: str = Field(
        default="1.0.0", validation_alias=AliasChoices("PNSM_SERVICE_VERSION", "SERVICE_VERSION")
    )

    # ------------------------------------------------------------- encryption
    #: Where data keys come from. The master plan requires ``kms`` in any
    #: deployment; ``static`` exists for local development and tests.
    key_provider: str = Field(
        default="static", validation_alias=AliasChoices("PNSM_KEY_PROVIDER", "KEY_PROVIDER")
    )
    fle_keys_raw: str = Field(
        default="", validation_alias=AliasChoices("PNSM_FLE_KEYS", "FLE_KEYS")
    )
    fle_active_key: str = Field(
        default="k1", validation_alias=AliasChoices("PNSM_FLE_ACTIVE_KEY", "FLE_ACTIVE_KEY")
    )
    #: ARN or alias of the customer master key that wraps every data key.
    kms_key_id: str = Field(
        default="", validation_alias=AliasChoices("PNSM_KMS_KEY_ID", "KMS_KEY_ID")
    )
    #: Unwrapped data keys are cached this long. Zero disables the cache and
    #: costs a KMS round trip on every check-in.
    kms_dek_cache_ttl_s: int = Field(
        default=300,
        ge=0,
        le=3600,
        validation_alias=AliasChoices("PNSM_KMS_DEK_CACHE_TTL_S", "KMS_DEK_CACHE_TTL_S"),
    )

    # --------------------------------------------------------------------- pin
    pin_pepper_raw: str = Field(
        default="", validation_alias=AliasChoices("PNSM_PIN_PEPPER", "PIN_PEPPER")
    )
    pin_pepper_version: str = Field(
        default="p1", validation_alias=AliasChoices("PNSM_PIN_PEPPER_VERSION", "PIN_PEPPER_VERSION")
    )
    bcrypt_cost: int = Field(
        default=10, ge=4, le=15, validation_alias=AliasChoices("PNSM_BCRYPT_COST", "BCRYPT_COST")
    )
    pin_min_length: int = Field(
        default=6, ge=4, le=12, validation_alias=AliasChoices("PNSM_PIN_MIN_LENGTH", "PIN_MIN_LENGTH")
    )
    pin_max_length: int = Field(
        default=12, ge=4, le=32, validation_alias=AliasChoices("PNSM_PIN_MAX_LENGTH", "PIN_MAX_LENGTH")
    )
    pin_max_attempts: int = Field(
        default=5, ge=1, le=20, validation_alias=AliasChoices("PNSM_PIN_MAX_ATTEMPTS", "PIN_MAX_ATTEMPTS")
    )
    pin_lockout_seconds: int = Field(
        default=900,
        ge=1,
        validation_alias=AliasChoices("PNSM_PIN_LOCKOUT_SECONDS", "PIN_LOCKOUT_SECONDS"),
    )

    # ------------------------------------------------------------ service auth
    hmac_secret_raw: str = Field(
        default="", validation_alias=AliasChoices("PNSM_HMAC_SECRET", "HMAC_SECRET")
    )
    hmac_max_skew_s: int = Field(
        default=300, ge=5, le=3600, validation_alias=AliasChoices("PNSM_HMAC_MAX_SKEW_S", "HMAC_MAX_SKEW_S")
    )
    auth_required: bool = Field(
        default=True, validation_alias=AliasChoices("PNSM_AUTH_REQUIRED", "AUTH_REQUIRED")
    )

    # ------------------------------------------------------------------- aws
    #: One region for every AWS service this container talks to. Keep it equal
    #: to the ECS cluster's region and the Atlas cluster's region: a
    #: cross-region hop costs 150-250 ms against a three-second budget.
    aws_region: str = Field(
        default="ap-southeast-1", validation_alias=AliasChoices("PNSM_AWS_REGION", "AWS_REGION")
    )

    # ---------------------------------------------------------------- storage
    #: Empty means "real AWS S3". Set it to a MinIO URL for local development.
    s3_endpoint: str = Field(
        default="", validation_alias=AliasChoices("PNSM_S3_ENDPOINT", "S3_ENDPOINT")
    )
    #: Left blank on ECS: the task role supplies credentials, and a static key
    #: pair in an environment variable is exactly what the task role replaces.
    s3_access_key_id: str = Field(
        default="", validation_alias=AliasChoices("PNSM_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
    )
    s3_secret_access_key: str = Field(
        default="",
        validation_alias=AliasChoices("PNSM_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    )
    s3_bucket: str = Field(
        default="pnsm-selfies", validation_alias=AliasChoices("PNSM_S3_BUCKET", "S3_BUCKET")
    )
    #: Server-side encryption at rest. Empty falls back to SSE-S3 (AES256).
    s3_sse_kms_key_id: str = Field(
        default="", validation_alias=AliasChoices("PNSM_S3_SSE_KMS_KEY_ID", "S3_SSE_KMS_KEY_ID")
    )
    #: CloudFront distribution in front of the bucket, for dashboard reads.
    cloudfront_domain: str = Field(
        default="", validation_alias=AliasChoices("PNSM_CLOUDFRONT_DOMAIN", "CLOUDFRONT_DOMAIN")
    )
    presign_put_ttl_s: int = Field(
        default=300, ge=30, le=3600, validation_alias=AliasChoices("PNSM_PRESIGN_PUT_TTL_S", "PRESIGN_PUT_TTL_S")
    )
    presign_get_ttl_s: int = Field(
        default=120, ge=30, le=3600, validation_alias=AliasChoices("PNSM_PRESIGN_GET_TTL_S", "PRESIGN_GET_TTL_S")
    )
    max_upload_bytes: int = Field(
        default=204_800,
        ge=1024,
        le=5_242_880,
        validation_alias=AliasChoices("PNSM_MAX_UPLOAD_BYTES", "MAX_UPLOAD_BYTES"),
    )

    # ------------------------------------------------------------------- model
    model_dir: Path = Field(
        default=Path("models"), validation_alias=AliasChoices("PNSM_MODEL_DIR", "MODEL_DIR")
    )
    rec_model_file: str = Field(
        default="w600k_mbf.onnx", validation_alias=AliasChoices("PNSM_REC_MODEL_FILE", "REC_MODEL_FILE")
    )
    det_model_file: str = Field(
        default="face_detection_yunet_2023mar.onnx",
        validation_alias=AliasChoices("PNSM_DET_MODEL_FILE", "DET_MODEL_FILE"),
    )
    model_version: str = Field(
        default="arcface_w600k_mbf_v1",
        validation_alias=AliasChoices("PNSM_MODEL_VERSION", "MODEL_VERSION"),
    )
    allow_stub_models: bool = Field(
        default=False, validation_alias=AliasChoices("PNSM_ALLOW_STUB_MODELS", "ALLOW_STUB_MODELS")
    )
    warmup_on_start: bool = Field(
        default=True, validation_alias=AliasChoices("PNSM_WARMUP_ON_START", "WARMUP_ON_START")
    )

    # ------------------------------------------------------------- calibration
    calibration_path: Path = Field(
        default=Path("calibration/calibration.json"),
        validation_alias=AliasChoices("PNSM_CALIBRATION_PATH", "CALIBRATION_PATH"),
    )
    approve_threshold: float = Field(
        default=85.0, ge=0.0, le=100.0, validation_alias=AliasChoices("PNSM_APPROVE_THRESHOLD", "APPROVE_THRESHOLD")
    )
    flag_threshold: float = Field(
        default=60.0, ge=0.0, le=100.0, validation_alias=AliasChoices("PNSM_FLAG_THRESHOLD", "FLAG_THRESHOLD")
    )
    #: ``two``  -- the master plan's model: at or above the threshold approve,
    #:            otherwise reject and raise a WebSocket alert for HR audit.
    #: ``three`` -- FR-07's model: an intermediate band is flagged for review
    #:            rather than rejected outright.
    #: Both approve at exactly the same score; they differ only in what happens
    #: below it. See docs/CALIBRATION.md.
    decision_bands: str = Field(
        default="two", validation_alias=AliasChoices("PNSM_DECISION_BANDS", "DECISION_BANDS")
    )

    # ------------------------------------------------- security headers (A02)
    security_headers_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("PNSM_SECURITY_HEADERS", "SECURITY_HEADERS"),
    )
    #: This service returns only JSON, so it can afford the strictest policy
    #: there is. The one exception is the interactive docs page, which needs
    #: its bundled script and stylesheet.
    csp_policy: str = Field(
        default="default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        validation_alias=AliasChoices("PNSM_CSP_POLICY", "CSP_POLICY"),
    )
    hsts_max_age_s: int = Field(
        default=31_536_000,
        ge=0,
        validation_alias=AliasChoices("PNSM_HSTS_MAX_AGE_S", "HSTS_MAX_AGE_S"),
    )

    # ------------------------------------------------------------ quality gate
    #
    # Every one of these carries the PNSM_-prefixed alias like the rest of the
    # file. Without it, pydantic-settings looks only for the bare name, and
    # `PNSM_MIN_BLUR_VAR=10.0` in a CI environment is read by nothing and
    # silently leaves the production default in place -- a config no-op that
    # looks exactly like a config that worked.
    min_det_score: float = Field(
        default=0.80, ge=0.0, le=1.0,
        validation_alias=AliasChoices("PNSM_MIN_DET_SCORE", "MIN_DET_SCORE"),
    )
    min_blur_var: float = Field(
        default=80.0, ge=0.0,
        validation_alias=AliasChoices("PNSM_MIN_BLUR_VAR", "MIN_BLUR_VAR"),
    )
    min_face_area_ratio: float = Field(
        default=0.015, ge=0.0, le=1.0,
        validation_alias=AliasChoices("PNSM_MIN_FACE_AREA_RATIO", "MIN_FACE_AREA_RATIO"),
    )
    min_brightness: float = Field(
        default=45.0, ge=0.0, le=255.0,
        validation_alias=AliasChoices("PNSM_MIN_BRIGHTNESS", "MIN_BRIGHTNESS"),
    )
    max_brightness: float = Field(
        default=215.0, ge=0.0, le=255.0,
        validation_alias=AliasChoices("PNSM_MAX_BRIGHTNESS", "MAX_BRIGHTNESS"),
    )
    #: Enrolment holds a higher bar than check-in: a bad reference photo
    #: poisons every future comparison for that employee.
    enrol_min_det_score: float = Field(
        default=0.90, ge=0.0, le=1.0,
        validation_alias=AliasChoices("PNSM_ENROL_MIN_DET_SCORE", "ENROL_MIN_DET_SCORE"),
    )
    enrol_min_blur_var: float = Field(
        default=120.0, ge=0.0,
        validation_alias=AliasChoices("PNSM_ENROL_MIN_BLUR_VAR", "ENROL_MIN_BLUR_VAR"),
    )
    enrol_min_face_area_ratio: float = Field(
        default=0.04, ge=0.0, le=1.0,
        validation_alias=AliasChoices("PNSM_ENROL_MIN_FACE_AREA_RATIO", "ENROL_MIN_FACE_AREA_RATIO"),
    )

    # ---------------------------------------------------------------- security
    max_clock_skew_s: int = Field(
        default=120, ge=10, le=3600, validation_alias=AliasChoices("PNSM_MAX_CLOCK_SKEW_S", "MAX_CLOCK_SKEW_S")
    )
    nonce_ttl_s: int = Field(
        default=600, ge=60, le=86_400, validation_alias=AliasChoices("PNSM_NONCE_TTL_S", "NONCE_TTL_S")
    )
    image_replay_window: int = Field(
        default=30, ge=0, le=500, validation_alias=AliasChoices("PNSM_IMAGE_REPLAY_WINDOW", "IMAGE_REPLAY_WINDOW")
    )
    verify_rate_limit_per_min: int = Field(
        default=12,
        ge=1,
        le=600,
        validation_alias=AliasChoices("PNSM_VERIFY_RATE_LIMIT_PER_MIN", "VERIFY_RATE_LIMIT_PER_MIN"),
    )

    # ------------------------------------------------------------------ admin
    admin_token: str = Field(
        default="", validation_alias=AliasChoices("PNSM_ADMIN_TOKEN", "ADMIN_TOKEN")
    )

    # ------------------------------------------------- liveness (Item 3, Flawless/
    # Ultra blueprint). Real, own-built active-illumination PAD signal -- not
    # ISO/IEC 30107-3 certified, which needs a real accredited physical lab
    # (iBeta) and is out of scope. See app/services/liveness.py.
    liveness_max_frame_bytes: int = Field(
        default=102_400,
        ge=1024,
        le=1_048_576,
        validation_alias=AliasChoices("PNSM_LIVENESS_MAX_FRAME_BYTES", "LIVENESS_MAX_FRAME_BYTES"),
    )
    #: Percentage confidence (0-100) a challenge must reach to pass. Not a
    #: certified detection rate -- a starting point to tune against real
    #: captures, documented plainly rather than presented as calibrated.
    liveness_min_confidence: float = Field(
        default=55.0,
        ge=0.0,
        le=100.0,
        validation_alias=AliasChoices("PNSM_LIVENESS_MIN_CONFIDENCE", "LIVENESS_MIN_CONFIDENCE"),
    )

    # ------------------------------------------------- passive PAD (Item 3b,
    # Flawless/Ultra blueprint). Real classical-CV heuristics (FFT moire
    # detection, Laplacian edge sharpness via app.ai.quality.blur_variance) --
    # not a trained anti-spoofing model, not ISO/IEC 30107-3 certified. See
    # app/ai/passive_pad.py.
    #: Above this FFT mid-band energy ratio, a frame is scored as fully
    #: "moire-suspicious" (confidence contribution floors at 0). A tuning
    #: starting point, not a measured threshold -- there is no labeled
    #: attack-instrument dataset here to calibrate against. 0.55 was picked
    #: empirically against synthetic test patterns (a 1/f "natural-like"
    #: image measures ~0.49, a hard periodic grid ~0.63 -- see
    #: tests/unit/test_passive_pad.py), not against real photographs.
    passive_pad_moire_baseline: float = Field(
        default=0.55,
        ge=0.0,
        le=1.0,
        validation_alias=AliasChoices("PNSM_PASSIVE_PAD_MOIRE_BASELINE", "PASSIVE_PAD_MOIRE_BASELINE"),
    )

    # ------------------------------------------------------------- validators
    @field_validator("log_level")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @model_validator(mode="after")
    def _check_bands(self) -> Settings:
        if self.decision_bands not in ("two", "three"):
            raise ConfigError(
                f"decision_bands must be 'two' or 'three', got {self.decision_bands!r}"
            )
        if self.flag_threshold >= self.approve_threshold:
            raise ConfigError(
                f"flag_threshold ({self.flag_threshold}) must be below "
                f"approve_threshold ({self.approve_threshold})"
            )
        if self.pin_min_length > self.pin_max_length:
            raise ConfigError("pin_min_length must not exceed pin_max_length")
        if self.min_brightness >= self.max_brightness:
            raise ConfigError("min_brightness must be below max_brightness")
        return self

    # --------------------------------------------------------- derived values
    @property
    def fle_keys(self) -> dict[str, bytes]:
        """Decode ``PNSM_FLE_KEYS`` into ``{key_version: 32-byte key}``."""
        if not self.fle_keys_raw:
            raise ConfigError(
                "PNSM_FLE_KEYS is not set. Generate one with "
                "`python scripts/gen_keys.py` and set it in the environment. "
                "The service will not start without it."
            )
        try:
            parsed: Any = json.loads(self.fle_keys_raw)
        except json.JSONDecodeError as exc:
            raise ConfigError('PNSM_FLE_KEYS must be JSON, e.g. {"k1":"<base64 32 bytes>"}') from exc
        if not isinstance(parsed, dict) or not parsed:
            raise ConfigError("PNSM_FLE_KEYS must be a non-empty JSON object")
        keys = {str(kv): _decode_secret(str(raw), f"PNSM_FLE_KEYS[{kv}]") for kv, raw in parsed.items()}
        if self.fle_active_key not in keys:
            raise ConfigError(
                f"PNSM_FLE_ACTIVE_KEY={self.fle_active_key!r} is not present in PNSM_FLE_KEYS "
                f"(available: {sorted(keys)})"
            )
        return keys

    @property
    def pin_pepper(self) -> bytes:
        if not self.pin_pepper_raw:
            raise ConfigError(
                "PNSM_PIN_PEPPER is not set. Generate one with `python scripts/gen_keys.py`."
            )
        return _decode_secret(self.pin_pepper_raw, "PNSM_PIN_PEPPER")

    @property
    def hmac_secret(self) -> bytes:
        if not self.hmac_secret_raw:
            raise ConfigError(
                "PNSM_HMAC_SECRET is not set. Generate one with `python scripts/gen_keys.py` "
                "and share it with Person 3 only."
            )
        return _decode_secret(self.hmac_secret_raw, "PNSM_HMAC_SECRET")

    @property
    def rec_model_path(self) -> Path:
        return self.model_dir / self.rec_model_file

    @property
    def det_model_path(self) -> Path:
        return self.model_dir / self.det_model_file

    def validate_startup(self) -> list[str]:
        """Force-evaluate every lazy secret so boot fails loudly, not lazily.

        Returns a list of human-readable warnings that are worth logging but do
        not justify refusing to start.
        """
        warnings: list[str] = []
        deployed = self.app_env not in ("local", "test")

        # --- key provider (master plan: keys live in AWS KMS) ---
        provider = self.key_provider.lower()
        if provider == "kms":
            if not self.kms_key_id:
                raise ConfigError(
                    "PNSM_KEY_PROVIDER=kms requires PNSM_KMS_KEY_ID (the CMK ARN or alias). "
                    "Create one with `python scripts/provision_aws.py --kms`."
                )
        elif provider == "static":
            self.fle_keys  # noqa: B018 - raises ConfigError when unusable
            if deployed:
                warnings.append(
                    "PNSM_KEY_PROVIDER=static in a deployed environment: the key that opens "
                    "every biometric vector is sitting in an environment variable. The master "
                    "plan requires AWS KMS. Set PNSM_KEY_PROVIDER=kms."
                )
        else:
            raise ConfigError(
                f"PNSM_KEY_PROVIDER must be 'kms' or 'static', got {self.key_provider!r}"
            )

        self.pin_pepper  # noqa: B018
        if self.auth_required:
            self.hmac_secret  # noqa: B018
        else:
            warnings.append(
                "AUTH_REQUIRED is false: service-to-service HMAC verification is DISABLED. "
                "Never do this outside local development."
            )
        if not self.calibration_path.exists():
            raise ConfigError(
                f"Calibration file not found at {self.calibration_path}. "
                "Run `python calibration/build_calibration.py` or copy the bootstrap file. "
                "The service refuses to start with an unknown decision threshold."
            )
        if self.allow_stub_models:
            warnings.append(
                "ALLOW_STUB_MODELS is true: a deterministic stub embedder is used instead of "
                "ArcFace. Results are meaningless for real faces. Tests only."
            )
        elif not self.rec_model_path.exists():
            raise ConfigError(
                f"Recognition model not found at {self.rec_model_path}. "
                "Run `python scripts/fetch_models.py` to download it."
            )
        if self.s3_endpoint.startswith("http://") and deployed:
            warnings.append(
                f"S3_ENDPOINT is plaintext HTTP ({self.s3_endpoint}) in a deployed environment. "
                "Selfies would traverse the network unencrypted, which fails OWASP A02."
            )
        if deployed and not self.s3_sse_kms_key_id:
            warnings.append(
                "PNSM_S3_SSE_KMS_KEY_ID is unset: selfies fall back to SSE-S3 rather than "
                "SSE-KMS, so object encryption is not attributable in CloudTrail."
            )
        if deployed and self.s3_access_key_id:
            warnings.append(
                "Static AWS credentials are set. On ECS the task role should supply them; "
                "a long-lived key pair in the environment is what the task role removes."
            )
        if self.bcrypt_cost > 12:
            warnings.append(
                f"BCRYPT_COST={self.bcrypt_cost} may exceed the check-in latency budget. "
                "Benchmark on the deployed task with scripts/bench_bcrypt.py before shipping."
            )
        return warnings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()


def reset_settings_cache() -> None:
    """Clear the singleton. Used by tests that manipulate the environment."""
    get_settings.cache_clear()
