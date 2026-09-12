"""Field-level encryption.

The tamper cases matter more than the happy path: every one of them is a
security control that must fail closed.
"""

from __future__ import annotations

import base64

import numpy as np
import pytest

from app.config import EMBEDDING_DIM
from app.crypto import fle
from app.errors import PnsmError, ReasonCode
from tests.helpers import make_key_provider, make_settings, unit_vector


def test_seal_open_round_trip_is_exact() -> None:
    provider = make_key_provider()
    vector = unit_vector(1)
    envelope = fle.seal(vector, user_ref="u1", model_version="m1", provider=provider)
    restored = fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert np.array_equal(restored, vector)


def test_envelope_has_the_documented_shape() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(2), user_ref="u1", model_version="m1", provider=provider)
    assert envelope["v"] == fle.ENVELOPE_VERSION
    assert envelope["alg"] == "AES-256-GCM"
    assert envelope["kv"] == "k1"
    assert len(base64.b64decode(envelope["iv"])) == 12
    assert len(base64.b64decode(envelope["tag"])) == 16
    assert len(base64.b64decode(envelope["ct"])) == EMBEDDING_DIM * 4
    assert envelope["created_at"].endswith("Z")


def test_envelope_fits_comfortably_in_the_atlas_tier() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(3), user_ref="u1", model_version="m1", provider=provider)
    # ~2.9 KB per employee under the static provider, ~3.2 KB once a wrapped
    # KMS data key rides along. A thousand employees is under 4 MB either way,
    # so storage is nowhere near the binding constraint on the Atlas cluster.
    assert fle.envelope_size_bytes(envelope) < 4096


def test_every_seal_uses_a_fresh_iv() -> None:
    provider = make_key_provider()
    vector = unit_vector(4)
    ivs = {
        fle.seal(vector, user_ref="u1", model_version="m1", provider=provider)["iv"]
        for _ in range(2000)
    }
    # GCM catastrophically loses confidentiality on IV reuse under one key.
    assert len(ivs) == 2000


def test_aad_binding_blocks_cross_employee_substitution() -> None:
    """The control that stops Employee A's envelope authenticating Employee B."""
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(5), user_ref="alice", model_version="m1", provider=provider)
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="bob", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_tampered_ciphertext_fails_closed() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(6), user_ref="u1", model_version="m1", provider=provider)
    raw = bytearray(base64.b64decode(envelope["ct"]))
    raw[0] ^= 0xFF
    envelope["ct"] = base64.b64encode(bytes(raw)).decode()
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_tampered_tag_fails_closed() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(7), user_ref="u1", model_version="m1", provider=provider)
    envelope["tag"] = base64.b64encode(b"\x00" * 16).decode()
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_tampered_model_version_fails_closed() -> None:
    """model_version is inside the AAD, so editing it breaks authentication."""
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(8), user_ref="u1", model_version="m1", provider=provider)
    envelope["model_version"] = "m1 "  # one trailing space
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_wrong_key_version_is_reported_not_crashed() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(9), user_ref="u1", model_version="m1", provider=provider)
    envelope["kv"] = "k99"
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_model_version_mismatch_is_a_workflow_error_not_a_security_event() -> None:
    """Re-enrolment needed is distinct from tampering, and must stay distinct."""
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(10), user_ref="u1", model_version="old", provider=provider)
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(
            envelope, user_ref="u1", provider=provider, expected_model_version="new"
        )
    assert caught.value.code is ReasonCode.MODEL_VERSION_MISMATCH


def test_missing_fields_are_rejected() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(11), user_ref="u1", model_version="m1", provider=provider)
    del envelope["tag"]
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_unsupported_envelope_version_is_rejected() -> None:
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(12), user_ref="u1", model_version="m1", provider=provider)
    envelope["v"] = 99
    with pytest.raises(PnsmError):
        fle.open_envelope(envelope, user_ref="u1", provider=provider)


def test_key_rotation_preserves_the_vector() -> None:
    """Rotate by re-sealing under a provider whose active key has moved on."""
    old = make_key_provider()
    new = make_key_provider(make_settings(fle_active_key="k2"))
    vector = unit_vector(13)

    first = fle.seal(vector, user_ref="u1", model_version="m1", provider=old)
    rotated = fle.rewrap(first, user_ref="u1", source=old, target=new)

    assert first["kv"] == "k1"
    assert rotated["kv"] == "k2"
    assert np.array_equal(fle.open_envelope(rotated, user_ref="u1", provider=new), vector)


def test_a_v1_envelope_still_opens() -> None:
    """The pre-AWS format. Refusing it would orphan every existing enrolment."""
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(15), user_ref="u1", model_version="m1", provider=provider)

    legacy = {k: v for k, v in envelope.items() if k != "kp"}
    legacy["v"] = 1
    assert "kp" not in legacy

    restored = fle.open_envelope(legacy, user_ref="u1", provider=provider)
    assert np.array_equal(restored, fle.open_envelope(envelope, user_ref="u1", provider=provider))


def test_an_envelope_round_tripped_through_a_schema_still_opens() -> None:
    """The regression that broke every check-in for one commit.

    `EnvelopeModel` declares `kp` and `dek` as optional, so `model_dump()` on a
    static-provider envelope materialises both as explicit nulls. A
    present-but-null field must read as absent: otherwise the provider name
    becomes the string "None" and `dek` is decoded as base64, and every single
    verification fails with DECRYPT_FAILED.
    """
    provider = make_key_provider()
    vector = unit_vector(17)
    envelope = fle.seal(vector, user_ref="u1", model_version="m1", provider=provider)

    # Exactly what pydantic hands the service for a static-provider envelope.
    as_dumped = {**envelope, "kp": envelope.get("kp"), "dek": None}
    assert as_dumped["dek"] is None

    restored = fle.open_envelope(as_dumped, user_ref="u1", provider=provider)
    assert np.array_equal(restored, vector)


def test_a_v1_envelope_with_explicit_nulls_still_opens() -> None:
    """The same, for an enrolment written before the AWS migration."""
    provider = make_key_provider()
    vector = unit_vector(18)
    envelope = fle.seal(vector, user_ref="u1", model_version="m1", provider=provider)

    legacy = {k: v for k, v in envelope.items() if k != "kp"}
    legacy["v"] = 1
    legacy["kp"] = None
    legacy["dek"] = None

    restored = fle.open_envelope(legacy, user_ref="u1", provider=provider)
    assert np.array_equal(restored, vector)


def test_an_envelope_sealed_by_another_provider_is_refused() -> None:
    """Switching providers without re-wrapping must fail loudly, not silently."""
    provider = make_key_provider()
    envelope = fle.seal(unit_vector(16), user_ref="u1", model_version="m1", provider=provider)
    envelope["kp"] = "kms"
    with pytest.raises(PnsmError) as caught:
        fle.open_envelope(envelope, user_ref="u1", provider=provider)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED
    assert "re-wrap" in str(caught.value.detail).lower()


def test_wrong_shape_is_rejected_before_encryption() -> None:
    provider = make_key_provider()
    with pytest.raises(fle.EnvelopeError):
        fle.seal(np.zeros(128, dtype=np.float32), user_ref="u1", model_version="m1", provider=provider)


def test_non_finite_vector_is_rejected() -> None:
    provider = make_key_provider()
    bad = unit_vector(14).copy()
    bad[0] = np.nan
    with pytest.raises(fle.EnvelopeError):
        fle.seal(bad, user_ref="u1", model_version="m1", provider=provider)
