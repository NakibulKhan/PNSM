"""Shared test construction helpers.

Deliberately free of pytest fixtures so that every module under ``tests/unit``,
``tests/security`` and ``tests/golden`` is a plain collection of functions.
That keeps them runnable by ``scripts/verify_offline.py`` on a machine where
pytest, FastAPI, boto3 and bcrypt are not installed -- which is exactly the
situation the CI memory gate and a fresh clone start from.
"""

from __future__ import annotations

import base64
import datetime as _dt
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.ai.detect import StubDetector
from app.ai.engine import FaceEngine
from app.ai.preprocess import DEFAULT_PREPROCESS
from app.ai.session import StubEmbedder
from app.config import Settings
from app.crypto.keyproviders import KeyProvider, StaticKeyProvider

REPO_ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_PATH = REPO_ROOT / "calibration" / "calibration.json"

TEST_FLE_KEY = base64.b64encode(b"\x01" * 32).decode()
TEST_FLE_KEY_2 = base64.b64encode(b"\x02" * 32).decode()
TEST_PEPPER = base64.b64encode(b"\x03" * 32).decode()
TEST_HMAC = base64.b64encode(b"\x04" * 32).decode()

ULID_A = "01JB7ZQ2K8N4V0X6M3PYE9TSRA"
ULID_B = "01JB80X4M2R7T9K1WQZ5NCVHDB"
ULID_C = "01JB81Y5N3S8V0M2XRA6PDWJEC"


def make_settings(**overrides: Any) -> Settings:
    """A Settings instance that never reads the ambient environment."""
    base: dict[str, Any] = {
        "app_env": "test",
        "log_level": "WARNING",
        "key_provider": "static",
        "fle_keys_raw": json.dumps({"k1": TEST_FLE_KEY, "k2": TEST_FLE_KEY_2}),
        "fle_active_key": "k1",
        "aws_region": "ap-southeast-1",
        "pin_pepper_raw": TEST_PEPPER,
        "hmac_secret_raw": TEST_HMAC,
        "bcrypt_cost": 4,  # tests must be fast; production cost is benchmarked
        "calibration_path": CALIBRATION_PATH,
        "allow_stub_models": True,
        "warmup_on_start": False,
        "admin_token": "test-admin-token",
        "model_version": "stub_v1",
        # build_detector()/build_embedder() prefer the REAL model whenever the
        # weight file exists on disk, regardless of allow_stub_models -- that
        # is the right production default (never silently downgrade to a
        # meaningless stub just because a flag was left on), but it means
        # tests must not share `models/`, the same directory a real local dev
        # checkout downloads real weights into via `python
        # scripts/fetch_models.py`. Pointing at a path that never exists is
        # what makes the stub path deterministic regardless of what is or is
        # not downloaded on the machine running the suite.
        "model_dir": REPO_ROOT / "tests" / "_stub_models_dir_never_created",
        # The stub detector reports a face filling 36% of the frame; the
        # default enrolment area floor is well below that.
        "min_blur_var": 10.0,
        "enrol_min_blur_var": 10.0,
    }
    base.update(overrides)
    return Settings(**base)


def make_engine(settings: Settings | None = None, *, faces: int = 1) -> FaceEngine:
    resolved = settings or make_settings()
    return FaceEngine(
        StubDetector(faces=faces), StubEmbedder(), resolved, DEFAULT_PREPROCESS
    )


def make_key_provider(settings: Settings | None = None) -> KeyProvider:
    """The static provider, wired from the test key map.

    KMS is covered separately in ``tests/unit/test_keyproviders.py`` with a
    stubbed client; everything that merely needs *a* working key uses this.
    """
    resolved = settings or make_settings()
    return StaticKeyProvider(resolved.fle_keys, resolved.fle_active_key)


def synthetic_frame(seed: int = 0, width: int = 640, height: int = 480) -> np.ndarray:
    """A smooth, compressible synthetic frame.

    Random noise is deliberately avoided: it does not compress, so a JPEG of it
    blows past the 200 KB ceiling and the test ends up asserting the wrong
    thing.
    """
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    phase = seed * 11.0
    frame = np.stack(
        [
            120 + 60 * np.sin((xx + phase) / 70.0),
            110 + 55 * np.cos((yy + phase) / 60.0),
            130 + 45 * np.sin((xx + yy + phase) / 90.0),
        ],
        axis=-1,
    )
    frame = np.clip(frame, 0, 255).astype(np.uint8)
    frame = cv2.GaussianBlur(frame, (0, 0), 1.0)
    cx, cy = width // 2, height // 2
    cv2.circle(frame, (cx, cy), min(width, height) // 5, (200, 180, 170), -1)
    cv2.circle(frame, (cx - 30, cy - 25), 12, (30, 30, 30), -1)
    cv2.circle(frame, (cx + 30, cy - 25), 12, (30, 30, 30), -1)
    return frame


def encode_jpeg(frame: np.ndarray, quality: int = 85) -> bytes:
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok, "cv2.imencode failed"
    return bytes(buffer.tobytes())


def synthetic_jpeg(seed: int = 0) -> bytes:
    return encode_jpeg(synthetic_frame(seed))


def unit_vector(seed: int = 0, dim: int = 512) -> np.ndarray:
    rng = np.random.default_rng(seed)
    vector = rng.standard_normal(dim).astype(np.float32)
    return (vector / np.linalg.norm(vector)).astype(np.float32)


def blended_vector(base: np.ndarray, other: np.ndarray, alpha: float) -> np.ndarray:
    """A vector at a controlled cosine distance from ``base``.

    Used to land a comparison deliberately inside the flagged band.
    """
    mixed = alpha * base + np.sqrt(max(1.0 - alpha**2, 0.0)) * other
    return (mixed / np.linalg.norm(mixed)).astype(np.float32)


def utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.UTC)


def b64_image(seed: int = 0) -> dict[str, str]:
    return {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(seed)).decode("ascii")}
