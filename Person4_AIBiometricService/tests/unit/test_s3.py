"""The S3 storage layer, with boto3 stubbed out.

boto3's request signing is boto3's problem and is not re-tested here.  What *is*
tested is everything this module contributes on top of it: which parameters get
signed, that the size ceiling is enforced before a body is read, that only keys
inside a managed prefix are ever handled, and that upstream failures become the
one documented error code instead of leaking a botocore exception.

The stub is injected into ``sys.modules`` so the production code path -- the
real ``import boto3`` inside ``_build_client`` -- is the one under test, rather
than a parallel implementation written for the tests.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from app.errors import PnsmError, ReasonCode
from tests.helpers import ULID_A, make_settings


class StubS3Client:
    """Records every call and returns plausible S3 responses."""

    def __init__(self, **kwargs: Any) -> None:
        self.init_kwargs = kwargs
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.objects: dict[str, bytes] = {}
        self.fail_with: Exception | None = None

    # --- the three methods app/storage/s3.py actually uses ---
    def head_object(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("head_object", kwargs))
        if self.fail_with:
            raise self.fail_with
        key = kwargs["Key"]
        if key not in self.objects:
            raise RuntimeError(f"NoSuchKey: {key}")
        return {"ContentLength": len(self.objects[key])}

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("get_object", kwargs))
        if self.fail_with:
            raise self.fail_with
        payload = self.objects[kwargs["Key"]]

        class _Body:
            def read(self, amount: int | None = None) -> bytes:
                return payload[:amount] if amount else payload

        return {"Body": _Body()}

    def generate_presigned_url(self, operation: str, **kwargs: Any) -> str:
        self.calls.append((f"presign:{operation}", kwargs))
        params = kwargs.get("Params", {})
        return (
            f"https://stub.s3.test/{params.get('Bucket')}/{params.get('Key')}"
            f"?op={operation}&exp={kwargs.get('ExpiresIn')}"
        )

    def last(self, name: str) -> dict[str, Any]:
        for call, kwargs in reversed(self.calls):
            if call == name:
                return kwargs
        raise AssertionError(f"{name} was never called; saw {[c for c, _ in self.calls]}")


def install_stub_boto3() -> StubS3Client:
    """Put a fake boto3 and botocore on the import path, and return the client."""
    client = StubS3Client()

    boto3_module = types.ModuleType("boto3")

    def _client(service: str, **kwargs: Any) -> StubS3Client:
        assert service == "s3", f"unexpected service {service!r}"
        client.init_kwargs = kwargs
        return client

    boto3_module.client = _client  # type: ignore[attr-defined]

    botocore = types.ModuleType("botocore")
    config_module = types.ModuleType("botocore.config")

    class Config:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs

    config_module.Config = Config  # type: ignore[attr-defined]
    botocore.config = config_module  # type: ignore[attr-defined]

    sys.modules["boto3"] = boto3_module
    sys.modules["botocore"] = botocore
    sys.modules["botocore.config"] = config_module
    return client


def build_store(**overrides):
    from app.storage.s3 import S3ObjectStore

    stub = install_stub_boto3()
    settings = make_settings(
        app_env="production",
        s3_endpoint="http://minio.local:9000",
        s3_access_key_id="key",
        s3_secret_access_key="secret",
        s3_bucket="pnsm-selfies",
        aws_region="ap-southeast-1",
        **overrides,
    )
    return S3ObjectStore(settings), stub, settings


REF_KEY = f"refs/alice/{ULID_A}.webp"
CHECKIN_KEY = f"checkins/2026/09/14/alice/{ULID_A}.webp"


# ------------------------------------------------------------------- client
def test_a_custom_endpoint_switches_to_path_addressing() -> None:
    """MinIO and other S3-compatible endpoints need path style, real S3 does not.

    Getting this backwards produces a signature that verifies locally and fails
    against AWS, or vice versa -- one of the few storage bugs that only appears
    after the move to the real bucket.
    """
    _, stub, _ = build_store()
    assert stub.init_kwargs["endpoint_url"] == "http://minio.local:9000"
    assert stub.init_kwargs["region_name"] == "ap-southeast-1"
    config = stub.init_kwargs["config"].kwargs
    assert config["signature_version"] == "s3v4"
    assert config["s3"] == {"addressing_style": "path"}  # custom endpoint -> MinIO style
    # Timeouts matter: a hung bucket must not eat the 3-second check-in budget.
    assert config["connect_timeout"] <= 5
    assert config["read_timeout"] <= 10


# ------------------------------------------------------------------- fetch
def test_an_object_round_trips() -> None:
    store, stub, settings = build_store()
    stub.objects[CHECKIN_KEY] = b"jpeg-bytes"
    assert store.get_object(CHECKIN_KEY, max_bytes=settings.max_upload_bytes) == b"jpeg-bytes"


def test_size_is_checked_before_the_body_is_read() -> None:
    """Refusing a huge object after streaming it into memory defeats the point."""
    store, stub, _ = build_store()
    stub.objects[CHECKIN_KEY] = b"x" * 500_000

    with pytest.raises(PnsmError) as caught:
        store.get_object(CHECKIN_KEY, max_bytes=204_800)
    assert caught.value.code is ReasonCode.PAYLOAD_TOO_LARGE

    performed = [name for name, _ in stub.calls]
    assert "head_object" in performed
    assert "get_object" not in performed, "the body was fetched despite being oversized"


def test_a_missing_object_becomes_the_documented_error_code() -> None:
    store, _, settings = build_store()
    with pytest.raises(PnsmError) as caught:
        store.get_object(CHECKIN_KEY, max_bytes=settings.max_upload_bytes)
    assert caught.value.code is ReasonCode.UPSTREAM_STORAGE_ERROR
    assert caught.value.spec.retryable is True


def test_a_transport_failure_does_not_leak_a_botocore_exception() -> None:
    store, stub, settings = build_store()
    stub.objects[CHECKIN_KEY] = b"x"
    stub.fail_with = ConnectionError("endpoint unreachable")
    with pytest.raises(PnsmError) as caught:
        store.get_object(CHECKIN_KEY, max_bytes=settings.max_upload_bytes)
    assert caught.value.code is ReasonCode.UPSTREAM_STORAGE_ERROR
    assert "endpoint unreachable" not in caught.value.envelope()["error"]["message"]


def test_fetching_a_key_outside_a_managed_prefix_is_refused() -> None:
    store, stub, settings = build_store()
    for hostile in ("../../etc/passwd", "/refs/alice/x.webp", "backups/dump.sql"):
        with pytest.raises(PnsmError):
            store.get_object(hostile, max_bytes=settings.max_upload_bytes)
    assert not stub.calls, "a hostile key reached the bucket"


# ----------------------------------------------------------------- presign
def test_presigned_put_signs_the_type_and_the_exact_length() -> None:
    """So the bucket itself rejects a mismatched or oversized upload."""
    store, stub, _ = build_store()
    signed = store.presign_put(CHECKIN_KEY, content_type="image/webp", content_length=152_340, ttl_s=300)

    params = stub.last("presign:put_object")["Params"]
    assert params["Bucket"] == "pnsm-selfies"
    assert params["Key"] == CHECKIN_KEY
    assert params["ContentType"] == "image/webp"
    assert params["ContentLength"] == 152_340
    assert stub.last("presign:put_object")["ExpiresIn"] == 300
    assert stub.last("presign:put_object")["HttpMethod"] == "PUT"

    assert signed["method"] == "PUT"
    assert signed["object_key"] == CHECKIN_KEY
    assert signed["headers"]["Content-Type"] == "image/webp"
    assert signed["headers"]["Content-Length"] == "152340"
    assert signed["expires_at"].endswith("Z")


def test_the_returned_headers_are_exactly_what_the_client_must_send() -> None:
    """A header the client omits or alters invalidates the signature."""
    store, _, _ = build_store()
    signed = store.presign_put(REF_KEY, content_type="image/jpeg", content_length=99_000, ttl_s=300)
    assert set(signed["headers"]) == {"Content-Type", "Content-Length"}
    assert signed["headers"]["Content-Length"] == str(99_000)


def test_presigned_get_is_short_lived() -> None:
    store, stub, _ = build_store()
    signed = store.presign_get(CHECKIN_KEY, ttl_s=120)
    assert stub.last("presign:get_object")["ExpiresIn"] == 120
    assert signed["method"] == "GET"
    assert signed["download_url"].startswith("https://")


def test_presigning_a_key_outside_a_managed_prefix_is_refused() -> None:
    store, stub, _ = build_store()
    with pytest.raises(PnsmError):
        store.presign_put("../secrets/x.webp", content_type="image/webp", content_length=1, ttl_s=300)
    with pytest.raises(PnsmError):
        store.presign_get("refs/../../etc/passwd", ttl_s=120)
    assert not stub.calls, "a hostile key was signed"


# ---------------------------------------------------------------- selection
def test_the_test_environment_gets_the_in_memory_store() -> None:
    from app.storage.s3 import InMemoryObjectStore, build_object_store

    assert isinstance(build_object_store(make_settings(app_env="test")), InMemoryObjectStore)


def test_the_in_memory_double_enforces_the_same_rules() -> None:
    """Otherwise tests pass against behaviour production does not have."""
    from app.storage.s3 import InMemoryObjectStore

    store = InMemoryObjectStore()
    store.put(CHECKIN_KEY, b"x" * 300_000)
    with pytest.raises(PnsmError) as caught:
        store.get_object(CHECKIN_KEY, max_bytes=204_800)
    assert caught.value.code is ReasonCode.PAYLOAD_TOO_LARGE

    with pytest.raises(PnsmError):
        store.get_object("../../etc/passwd", max_bytes=204_800)
    with pytest.raises(PnsmError):
        store.presign_put("../x", content_type="image/webp", content_length=1, ttl_s=300)
