"""Key providers, including AWS KMS envelope encryption.

The KMS client is stubbed, but the stub models the two properties the design
actually leans on -- a fresh data key per call, and an encryption context that
must match on decrypt or the unwrap is refused.  Those are what make the
envelope scheme worth having, so testing against a stub that ignored them would
prove nothing.

Reference: master plan, Quadrant IV -- keys held in AWS KMS.
"""

from __future__ import annotations

import base64
import json
import os

import numpy as np
import pytest

from app.config import ConfigError
from app.crypto import fle
from app.crypto.keyproviders import (
    PROVIDER_KMS,
    PROVIDER_STATIC,
    AwsKmsKeyProvider,
    KeyUnavailableError,
    StaticKeyProvider,
    build_key_provider,
)
from app.errors import PnsmError, ReasonCode
from tests.helpers import make_key_provider, make_settings, unit_vector

CMK = "arn:aws:kms:ap-southeast-1:000000000000:key/pnsm-biometrics"


class StubKms:
    """A behavioural model of the two KMS calls this service makes.

    The wrapped blob carries the encryption context, and ``decrypt`` refuses a
    mismatch -- exactly as KMS does, and for the same reason: it is what makes
    the context a security control rather than decoration.
    """

    def __init__(self) -> None:
        self.generate_calls: list[dict] = []
        self.decrypt_calls: list[dict] = []
        self.fail_with: Exception | None = None

    def generate_data_key(self, *, KeyId: str, KeySpec: str, EncryptionContext: dict) -> dict:
        self.generate_calls.append(
            {"KeyId": KeyId, "KeySpec": KeySpec, "EncryptionContext": dict(EncryptionContext)}
        )
        if self.fail_with:
            raise self.fail_with
        assert KeySpec == "AES_256", f"unexpected key spec {KeySpec}"
        plaintext = os.urandom(32)
        blob = json.dumps(
            {
                "k": base64.b64encode(plaintext).decode(),
                "cmk": KeyId,
                "ctx": EncryptionContext,
            },
            sort_keys=True,
        ).encode()
        return {"Plaintext": plaintext, "CiphertextBlob": blob}

    def decrypt(self, *, CiphertextBlob: bytes, EncryptionContext: dict, KeyId: str) -> dict:
        self.decrypt_calls.append(
            {"EncryptionContext": dict(EncryptionContext), "KeyId": KeyId}
        )
        if self.fail_with:
            raise self.fail_with
        try:
            parsed = json.loads(CiphertextBlob)
        except Exception as exc:
            raise RuntimeError("InvalidCiphertextException") from exc
        if parsed["ctx"] != EncryptionContext:
            # KMS returns InvalidCiphertextException when the context differs.
            raise RuntimeError("InvalidCiphertextException: encryption context mismatch")
        return {"Plaintext": base64.b64decode(parsed["k"])}


def kms_provider(cache_ttl_s: int = 300) -> tuple[AwsKmsKeyProvider, StubKms]:
    stub = StubKms()
    return (
        AwsKmsKeyProvider(CMK, region="ap-southeast-1", client=stub, cache_ttl_s=cache_ttl_s),
        stub,
    )


# ------------------------------------------------------------------- static
def test_the_static_provider_returns_the_active_key() -> None:
    provider = make_key_provider()
    key = provider.data_key_for_encrypt({"user_ref": "alice"})
    assert provider.name == PROVIDER_STATIC
    assert key.key_id == "k1"
    assert key.wrapped is None
    assert len(key.plaintext) == 32


def test_the_static_provider_refuses_an_absent_active_key() -> None:
    settings = make_settings()
    with pytest.raises(ConfigError):
        StaticKeyProvider(settings.fle_keys, "k99")


def test_the_static_provider_reports_an_unknown_key_version() -> None:
    provider = make_key_provider()
    with pytest.raises(KeyUnavailableError):
        provider.data_key_for_decrypt("k99", None, {})


# ---------------------------------------------------------------------- kms
def test_kms_mints_a_fresh_data_key_per_enrolment() -> None:
    """Reusing one DEK across employees would defeat the point of envelopes."""
    provider, stub = kms_provider()
    context = {"user_ref": "alice", "purpose": "pnsm-face-embedding"}

    first = provider.data_key_for_encrypt(context)
    second = provider.data_key_for_encrypt(context)

    assert provider.name == PROVIDER_KMS
    assert first.plaintext != second.plaintext
    assert first.wrapped != second.wrapped
    assert len(stub.generate_calls) == 2
    assert stub.generate_calls[0]["KeyId"] == CMK
    assert stub.generate_calls[0]["EncryptionContext"] == context


def test_the_encryption_context_is_sent_to_kms() -> None:
    """It appears in CloudTrail, which is what makes an unwrap attributable."""
    provider, stub = kms_provider()
    provider.data_key_for_encrypt({"user_ref": "alice", "model_version": "m1"})
    assert stub.generate_calls[0]["EncryptionContext"] == {
        "user_ref": "alice",
        "model_version": "m1",
    }


def test_unwrapping_under_a_different_context_is_refused() -> None:
    """A stolen wrapped key cannot be redeemed for another employee."""
    provider, _ = kms_provider(cache_ttl_s=0)
    alice = {"user_ref": "alice", "purpose": "pnsm-face-embedding"}
    bob = {"user_ref": "bob", "purpose": "pnsm-face-embedding"}

    key = provider.data_key_for_encrypt(alice)
    provider.clear_cache()

    with pytest.raises(KeyUnavailableError):
        provider.data_key_for_decrypt(CMK, key.wrapped, bob)


def test_the_data_key_cache_avoids_a_kms_call_per_check_in() -> None:
    """Without it every check-in pays a network round trip and a KMS charge."""
    provider, stub = kms_provider()
    context = {"user_ref": "alice"}
    key = provider.data_key_for_encrypt(context)

    for _ in range(50):
        assert provider.data_key_for_decrypt(CMK, key.wrapped, context) == key.plaintext

    assert stub.decrypt_calls == [], "the cache did not prevent a single KMS Decrypt"


def test_a_cold_cache_falls_back_to_kms() -> None:
    provider, stub = kms_provider()
    context = {"user_ref": "alice"}
    key = provider.data_key_for_encrypt(context)
    provider.clear_cache()

    assert provider.data_key_for_decrypt(CMK, key.wrapped, context) == key.plaintext
    assert len(stub.decrypt_calls) == 1


def test_a_kms_outage_surfaces_as_key_unavailable() -> None:
    provider, stub = kms_provider()
    stub.fail_with = ConnectionError("kms endpoint unreachable")
    with pytest.raises(KeyUnavailableError) as caught:
        provider.data_key_for_encrypt({"user_ref": "alice"})
    assert "GenerateDataKey" in str(caught.value)


def test_a_kms_envelope_without_a_wrapped_key_is_refused() -> None:
    provider, _ = kms_provider()
    with pytest.raises(KeyUnavailableError):
        provider.data_key_for_decrypt(CMK, None, {"user_ref": "alice"})


def test_an_empty_cmk_is_a_configuration_error() -> None:
    with pytest.raises(ConfigError):
        AwsKmsKeyProvider("", region="ap-southeast-1", client=StubKms())


# ---------------------------------------------------- end to end through fle
def test_seal_and_open_under_kms() -> None:
    provider, stub = kms_provider()
    vector = unit_vector(21)

    envelope = fle.seal(vector, user_ref="alice", model_version="m1", provider=provider)
    assert envelope["kp"] == PROVIDER_KMS
    assert envelope["kv"] == CMK
    assert "dek" in envelope, "the wrapped data key must travel with the ciphertext"

    restored = fle.open_envelope(envelope, user_ref="alice", provider=provider)
    assert np.array_equal(restored, vector)
    assert len(stub.generate_calls) == 1


def test_the_wrapped_key_alone_does_not_open_another_employees_vector() -> None:
    """Both layers bind the employee: the GCM AAD and the KMS context."""
    provider, _ = kms_provider(cache_ttl_s=0)
    envelope = fle.seal(unit_vector(22), user_ref="alice", model_version="m1", provider=provider)
    provider.clear_cache()

    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="bob", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_a_kms_envelope_is_still_small_enough_to_store() -> None:
    provider, _ = kms_provider()
    envelope = fle.seal(unit_vector(23), user_ref="alice", model_version="m1", provider=provider)
    assert fle.envelope_size_bytes(envelope) < 4096


def test_migrating_from_static_keys_to_kms_preserves_the_vector() -> None:
    """The upgrade path: no employee has to re-enrol."""
    static = make_key_provider()
    kms, _ = kms_provider()
    vector = unit_vector(24)

    legacy = fle.seal(vector, user_ref="alice", model_version="m1", provider=static)
    migrated = fle.rewrap(legacy, user_ref="alice", source=static, target=kms)

    assert legacy["kp"] == PROVIDER_STATIC
    assert migrated["kp"] == PROVIDER_KMS
    assert np.array_equal(fle.open_envelope(migrated, user_ref="alice", provider=kms), vector)


# ------------------------------------------------------------------ factory
def test_the_factory_honours_the_configured_provider() -> None:
    assert build_key_provider(make_settings(key_provider="static")).name == PROVIDER_STATIC


def test_the_factory_rejects_an_unknown_provider() -> None:
    with pytest.raises(ConfigError):
        build_key_provider(make_settings(key_provider="magic"))


def test_kms_selection_requires_a_key_id() -> None:
    with pytest.raises(ConfigError):
        build_key_provider(make_settings(key_provider="kms", kms_key_id=""), client=StubKms())


def test_kms_selection_builds_the_provider() -> None:
    provider = build_key_provider(
        make_settings(key_provider="kms", kms_key_id=CMK), client=StubKms()
    )
    assert provider.name == PROVIDER_KMS
