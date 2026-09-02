"""pytest configuration and HTTP-level fixtures.

Only the API and contract suites need these. Everything under ``tests/unit``,
``tests/security`` and ``tests/golden`` is fixture-free on purpose so it also
runs under ``scripts/verify_offline.py``.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.helpers import (  # noqa: E402
    CALIBRATION_PATH,
    TEST_FLE_KEY,
    TEST_FLE_KEY_2,
    TEST_HMAC,
    TEST_PEPPER,
    make_settings,
)

ADMIN_TOKEN = "test-admin-token"


@pytest.fixture(autouse=True, scope="session")
def _test_environment() -> Iterator[None]:
    """Populate the environment so ``Settings()`` works anywhere in the suite."""
    previous = dict(os.environ)
    os.environ.update(
        {
            "PNSM_APP_ENV": "test",
            "PNSM_LOG_LEVEL": "WARNING",
            "PNSM_FLE_KEYS": json.dumps({"k1": TEST_FLE_KEY, "k2": TEST_FLE_KEY_2}),
            "PNSM_FLE_ACTIVE_KEY": "k1",
            "PNSM_PIN_PEPPER": TEST_PEPPER,
            "PNSM_HMAC_SECRET": TEST_HMAC,
            "PNSM_BCRYPT_COST": "4",
            "PNSM_CALIBRATION_PATH": str(CALIBRATION_PATH),
            "PNSM_ALLOW_STUB_MODELS": "true",
            "PNSM_WARMUP_ON_START": "true",
            "PNSM_MODEL_VERSION": "stub_v1",
            "PNSM_ADMIN_TOKEN": ADMIN_TOKEN,
            "PNSM_MIN_BLUR_VAR": "10.0",
            "PNSM_ENROL_MIN_BLUR_VAR": "10.0",
        }
    )
    yield
    os.environ.clear()
    os.environ.update(previous)


@pytest.fixture()
def settings():
    return make_settings()


class SignedClient:
    """A TestClient that signs every request the way Person 3's backend must.

    Doubling as executable documentation: if this helper is wrong, the contract
    tests fail, so it cannot drift from what the service actually accepts.
    """

    def __init__(self, client: Any, secret: bytes) -> None:
        self._client = client
        self._secret = secret

    def post(self, url: str, payload: dict[str, Any], *, admin: bool = False, **kwargs: Any):
        from app.crypto import hmac_auth

        body = json.dumps(payload).encode("utf-8")
        timestamp = hmac_auth.current_timestamp()
        headers = {
            "Content-Type": "application/json",
            hmac_auth.TIMESTAMP_HEADER: timestamp,
            hmac_auth.SIGNATURE_HEADER: hmac_auth.sign(self._secret, timestamp, body),
        }
        if admin:
            headers["X-PNSM-Admin"] = ADMIN_TOKEN
        headers.update(kwargs.pop("headers", {}))
        return self._client.post(url, content=body, headers=headers, **kwargs)

    def post_unsigned(self, url: str, payload: dict[str, Any], **kwargs: Any):
        return self._client.post(url, json=payload, **kwargs)

    def get(self, url: str, *, admin: bool = False, **kwargs: Any):
        from app.crypto import hmac_auth

        timestamp = hmac_auth.current_timestamp()
        headers = {
            hmac_auth.TIMESTAMP_HEADER: timestamp,
            hmac_auth.SIGNATURE_HEADER: hmac_auth.sign(self._secret, timestamp, b""),
        }
        if admin:
            headers["X-PNSM-Admin"] = ADMIN_TOKEN
        headers.update(kwargs.pop("headers", {}))
        return self._client.get(url, headers=headers, **kwargs)


@pytest.fixture()
def app(_test_environment):
    from app.config import reset_settings_cache
    from app.main import create_app

    reset_settings_cache()
    return create_app()


@pytest.fixture()
def client(app) -> Iterator[SignedClient]:
    from fastapi.testclient import TestClient

    with TestClient(app) as raw:
        yield SignedClient(raw, base64.b64decode(TEST_HMAC))


@pytest.fixture()
def raw_client(app) -> Iterator[Any]:
    from fastapi.testclient import TestClient

    with TestClient(app) as raw:
        yield raw
