"""Field-level encryption for face embedding vectors.

AES-256-GCM, applied *inside this service*, so that Person 3's backend and the
MongoDB Atlas cluster only ever hold opaque ciphertext.  A mistake elsewhere in
the platform cannot leak biometric data, because no other component ever sees a
plaintext vector.

**On the name "CSFLE".** The master plan asks for "Client-Side Field Level
Encryption (CSFLE) utilizing an AES-256-GCM cipher". Those are two different
things and it is worth being exact, because the difference is load-bearing:

* MongoDB's *CSFLE driver feature* encrypts with **AEAD AES-256-CBC and
  HMAC-SHA-256**, not GCM, and its automatic mode needs the ``crypt_shared``
  library or ``mongocryptd``.
* What this module does is *application-layer* field encryption: the vector is
  sealed with **AES-256-GCM** before it is ever handed to a driver.

The plan's stated cipher is therefore only achievable the second way, which is
the way implemented here. It is also the better fit: the vector is an opaque
blob that is never queried on, so nothing is lost by not using MongoDB's
searchable encryption, and GCM's authentication tag buys a tamper check that
CBC mode would not.

Two further properties go beyond what the plan asks for:

* the **AAD binds each ciphertext to one employee**, so an attacker with write
  access to Atlas cannot move Employee A's encrypted embedding onto Employee
  B's document -- the tag check fails and the read is rejected rather than
  silently authenticating the wrong person;
* under the KMS provider the **encryption context** binds the same identifier
  at the KMS layer, so an unwrap for the wrong employee is refused by AWS and
  recorded in CloudTrail.

Reference: master plan, Quadrant IV.
"""

from __future__ import annotations

import base64
import binascii
import datetime as _dt
import os
from typing import Any, Final

import numpy as np
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import EMBEDDING_DIM, GCM_IV_LEN, GCM_TAG_LEN
from app.crypto.keyproviders import (
    PROVIDER_KMS,
    PROVIDER_STATIC,
    KeyProvider,
    KeyUnavailableError,
)
from app.errors import PnsmError, ReasonCode

#: Envelope schema versions this module can read.
#:
#: v1 -- static key referenced by ``kv``, written by the pre-AWS build.
#: v2 -- carries ``kp`` (key provider) and, for KMS, a wrapped data key.
#:
#: Readers must keep accepting every version they have ever written, or a
#: deployment upgrade silently orphans every existing enrolment.
ENVELOPE_VERSION: Final[int] = 2
SUPPORTED_VERSIONS: Final[frozenset[int]] = frozenset({1, 2})
ALGORITHM: Final[str] = "AES-256-GCM"

#: Recorded in the KMS encryption context so an unwrap is attributable.
KMS_PURPOSE: Final[str] = "pnsm-face-embedding"

_REQUIRED_FIELDS: Final[tuple[str, ...]] = ("v", "kv", "alg", "iv", "ct", "tag", "model_version")


class EnvelopeError(ValueError):
    """The envelope is structurally invalid, before any cryptography runs."""


def _b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64d(value: Any, field: str, expect_len: int | None = None) -> bytes:
    if not isinstance(value, str):
        raise EnvelopeError(f"envelope.{field} must be a base64 string")
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise EnvelopeError(f"envelope.{field} is not valid base64") from exc
    if expect_len is not None and len(raw) != expect_len:
        raise EnvelopeError(f"envelope.{field} must be {expect_len} bytes, got {len(raw)}")
    return raw


def build_aad(user_ref: str, model_version: str, key_id: str) -> bytes:
    """AES-GCM additional authenticated data. Order and separator are format."""
    return f"{user_ref}|{model_version}|{key_id}".encode()


def build_encryption_context(user_ref: str, model_version: str) -> dict[str, str]:
    """KMS encryption context.

    Appears in CloudTrail, so it carries identifiers and never secrets.
    """
    return {"user_ref": user_ref, "model_version": model_version, "purpose": KMS_PURPOSE}


def seal(
    vector: np.ndarray,
    *,
    user_ref: str,
    model_version: str,
    provider: KeyProvider,
    created_at: _dt.datetime | None = None,
) -> dict[str, Any]:
    """Encrypt an embedding vector into a storable envelope.

    Args:
        vector: L2-normalised embedding, shape ``(512,)``.
        user_ref: Employee identifier; bound into both the AAD and, under KMS,
            the encryption context.
        model_version: Model that produced the vector; also bound in.
        provider: Where the data key comes from.
        created_at: Timestamp recorded in the envelope. Defaults to now (UTC).

    Returns:
        A JSON-serialisable envelope. Persist it verbatim into the
        ``FaceEmbeddings`` collection; do not reformat it.
    """
    if not user_ref:
        raise EnvelopeError("user_ref must not be empty")
    arr = np.asarray(vector, dtype=np.float32)
    if arr.shape != (EMBEDDING_DIM,):
        raise EnvelopeError(f"vector must have shape ({EMBEDDING_DIM},), got {arr.shape}")
    if not np.all(np.isfinite(arr)):
        raise EnvelopeError("vector contains NaN or infinity")

    context = build_encryption_context(user_ref, model_version)
    try:
        data_key = provider.data_key_for_encrypt(context)
    except KeyUnavailableError as exc:
        raise PnsmError(ReasonCode.INTERNAL, detail=f"could not obtain a data key: {exc}") from exc

    iv = os.urandom(GCM_IV_LEN)
    aad = build_aad(user_ref, model_version, data_key.key_id)
    blob = AESGCM(data_key.plaintext).encrypt(iv, arr.tobytes(), aad)
    ct, tag = blob[:-GCM_TAG_LEN], blob[-GCM_TAG_LEN:]

    stamp = created_at or _dt.datetime.now(_dt.UTC)
    envelope: dict[str, Any] = {
        "v": ENVELOPE_VERSION,
        "kp": provider.name,
        "kv": data_key.key_id,
        "alg": ALGORITHM,
        "iv": _b64e(iv),
        "ct": _b64e(ct),
        "tag": _b64e(tag),
        "model_version": model_version,
        "created_at": stamp.astimezone(_dt.UTC).isoformat().replace("+00:00", "Z"),
    }
    if data_key.wrapped is not None:
        envelope["dek"] = _b64e(data_key.wrapped)
    return envelope


def open_envelope(
    envelope: dict[str, Any],
    *,
    user_ref: str,
    provider: KeyProvider,
    expected_model_version: str | None = None,
) -> np.ndarray:
    """Decrypt an envelope back into an embedding vector.

    Raises:
        PnsmError: ``DECRYPT_FAILED`` on tampering, a wrong key, an
            unavailable key, or a cross-employee substitution;
            ``MODEL_VERSION_MISMATCH`` when the stored vector came from a
            different model than the one running.
    """
    if not isinstance(envelope, dict):
        raise PnsmError(ReasonCode.DECRYPT_FAILED, detail="envelope is not an object")
    missing = [f for f in _REQUIRED_FIELDS if f not in envelope]
    if missing:
        raise PnsmError(ReasonCode.DECRYPT_FAILED, detail=f"envelope missing fields: {missing}")

    version = envelope["v"]
    if version not in SUPPORTED_VERSIONS:
        raise PnsmError(
            ReasonCode.DECRYPT_FAILED, detail=f"unsupported envelope version {version!r}"
        )
    if envelope["alg"] != ALGORITHM:
        raise PnsmError(
            ReasonCode.DECRYPT_FAILED, detail=f"unsupported algorithm {envelope['alg']!r}"
        )

    stored_model = str(envelope["model_version"])
    # Checked before decryption: re-enrolment is a workflow problem, not a
    # security incident, and confusing the two corrupts the audit trail.
    if expected_model_version is not None and stored_model != expected_model_version:
        raise PnsmError(
            ReasonCode.MODEL_VERSION_MISMATCH,
            detail=f"stored embedding is {stored_model!r}, service runs {expected_model_version!r}",
        )

    key_id = str(envelope["kv"])
    # v1 predates the provider field and was always sealed with a static key.
    #
    # `or None` matters as much as the default: a v1 envelope that has been
    # through a pydantic model comes back with `kp: None` and `dek: None`
    # materialised, because those fields are declared optional. Treating a
    # present-but-null field as absent is what keeps every pre-AWS enrolment
    # readable -- `str(None)` would otherwise be the provider name "None".
    sealed_by = str(envelope.get("kp") or PROVIDER_STATIC)
    if sealed_by not in (PROVIDER_STATIC, PROVIDER_KMS):
        raise PnsmError(ReasonCode.DECRYPT_FAILED, detail=f"unknown key provider {sealed_by!r}")
    if sealed_by != provider.name:
        raise PnsmError(
            ReasonCode.DECRYPT_FAILED,
            detail=(
                f"envelope was sealed with the {sealed_by!r} key provider but the service "
                f"is running {provider.name!r}. Re-wrap before switching providers."
            ),
        )

    try:
        iv = _b64d(envelope["iv"], "iv", GCM_IV_LEN)
        ct = _b64d(envelope["ct"], "ct")
        tag = _b64d(envelope["tag"], "tag", GCM_TAG_LEN)
        raw_dek = envelope.get("dek")
        wrapped = _b64d(raw_dek, "dek") if raw_dek else None
    except EnvelopeError as exc:
        raise PnsmError(ReasonCode.DECRYPT_FAILED, detail=str(exc)) from exc

    context = build_encryption_context(user_ref, stored_model)
    try:
        key = provider.data_key_for_decrypt(key_id, wrapped, context)
    except KeyUnavailableError as exc:
        raise PnsmError(ReasonCode.DECRYPT_FAILED, detail=str(exc)) from exc

    aad = build_aad(user_ref, stored_model, key_id)
    try:
        plain = AESGCM(key).decrypt(iv, ct + tag, aad)
    except InvalidTag as exc:
        # Tampered ciphertext, wrong key, or an envelope copied from another
        # employee. All three are security events.
        raise PnsmError(
            ReasonCode.DECRYPT_FAILED,
            detail="GCM tag verification failed (tampering, wrong key, or wrong user_ref)",
        ) from exc

    if len(plain) != EMBEDDING_DIM * 4:
        raise PnsmError(
            ReasonCode.DECRYPT_FAILED,
            detail=f"plaintext is {len(plain)} bytes, expected {EMBEDDING_DIM * 4}",
        )
    return np.frombuffer(plain, dtype=np.float32).copy()


def rewrap(
    envelope: dict[str, Any],
    *,
    user_ref: str,
    source: KeyProvider,
    target: KeyProvider | None = None,
) -> dict[str, Any]:
    """Re-seal an envelope under a different key, or a different provider.

    This is both the key-rotation primitive and the migration path from static
    keys to KMS: open with ``source``, seal with ``target``. Embeddings survive
    intact, so no employee has to re-enrol.
    """
    vector = open_envelope(envelope, user_ref=user_ref, provider=source)
    return seal(
        vector,
        user_ref=user_ref,
        model_version=str(envelope["model_version"]),
        provider=target or source,
    )


def envelope_size_bytes(envelope: dict[str, Any]) -> int:
    """Approximate stored size, for capacity planning against the Atlas tier."""
    import json

    return len(json.dumps(envelope, separators=(",", ":")).encode("utf-8"))
