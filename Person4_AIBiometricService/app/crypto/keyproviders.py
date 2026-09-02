"""Key providers for field-level encryption.

The master plan requires the biometric encryption keys to be "held securely
within the AWS Key Management Service".  That means envelope encryption, which
is a different shape from a single master key in an environment variable:

* a fresh **data encryption key** (DEK) is minted per enrolment;
* the DEK encrypts the embedding vector locally, with AES-256-GCM;
* KMS returns the DEK already wrapped under a **customer master key** (CMK)
  that never leaves the HSM, and the wrapped blob travels with the ciphertext;
* decryption asks KMS to unwrap the DEK, then opens the vector locally.

The vector itself never reaches AWS, and the key that could open it never
exists outside this process in plaintext for longer than one request.

Two providers implement the same protocol:

* :class:`AwsKmsKeyProvider` -- production. Keys live in KMS.
* :class:`StaticKeyProvider` -- local development and tests, and the format
  the earlier build wrote. Keys come from ``PNSM_FLE_KEYS``.

Envelopes record which provider sealed them, so a deployment can migrate from
static keys to KMS without a bulk re-encryption: old envelopes keep opening.

Reference: master plan, Quadrant IV -- "Advanced Data Privacy and Client-Side
Field Level Encryption".
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Protocol

from app.config import SECRET_LEN, ConfigError, Settings

log = logging.getLogger(__name__)

#: Provider identifiers written into the ``kp`` field of an envelope.
PROVIDER_STATIC = "static"
PROVIDER_KMS = "kms"


@dataclass(frozen=True)
class DataKey:
    """A key usable for one seal, plus whatever is needed to recover it.

    ``wrapped`` is ``None`` for the static provider: the key is recovered by
    looking ``key_id`` up in the configured key map rather than by unwrapping.
    """

    plaintext: bytes
    key_id: str
    wrapped: bytes | None = None


class KeyProvider(Protocol):
    """Everything :mod:`app.crypto.fle` needs from a key source."""

    @property
    def name(self) -> str: ...

    @property
    def active_key_id(self) -> str: ...

    def data_key_for_encrypt(self, context: dict[str, str]) -> DataKey: ...

    def data_key_for_decrypt(
        self, key_id: str, wrapped: bytes | None, context: dict[str, str]
    ) -> bytes: ...


# --------------------------------------------------------------------- static
class StaticKeyProvider:
    """Keys from ``PNSM_FLE_KEYS``. No external dependency, no network.

    Correct for local development and tests. In a deployment it means the key
    that opens every biometric vector sits in an environment variable, which
    is exactly the weakness the KMS provider removes.
    """

    def __init__(self, keys: dict[str, bytes], active: str) -> None:
        if active not in keys:
            raise ConfigError(f"active key {active!r} is not present in the key map")
        self._keys = keys
        self._active = active

    @property
    def name(self) -> str:
        return PROVIDER_STATIC

    @property
    def active_key_id(self) -> str:
        """The version a fresh seal will use.

        Exposed because ``scripts/rotate_keys.py`` needs to tell an envelope
        that is already current from one that still has to be re-wrapped, and
        because ``/ready`` reports it.
        """
        return self._active

    def data_key_for_encrypt(self, context: dict[str, str]) -> DataKey:
        return DataKey(plaintext=self._keys[self._active], key_id=self._active, wrapped=None)

    def data_key_for_decrypt(
        self, key_id: str, wrapped: bytes | None, context: dict[str, str]
    ) -> bytes:
        try:
            return self._keys[key_id]
        except KeyError as exc:
            raise KeyUnavailableError(
                f"envelope references key version {key_id!r}, which is not loaded "
                f"(available: {sorted(self._keys)})"
            ) from exc


class KeyUnavailableError(RuntimeError):
    """The key needed to open an envelope cannot be obtained."""


# ------------------------------------------------------------------ dek cache
class _DekCache:
    """Bounded, expiring cache of unwrapped data keys.

    Without it, every check-in costs a KMS ``Decrypt`` round trip -- tens of
    milliseconds against a three-second end-to-end budget, plus a per-request
    charge. With it, the common case is a dictionary lookup.

    Plaintext keys in memory are a deliberate, bounded trade: entries expire,
    the map is size-capped, and nothing is written to disk.
    """

    def __init__(self, *, ttl_s: int = 300, max_entries: int = 256) -> None:
        self._ttl = ttl_s
        self._max = max_entries
        self._data: OrderedDict[str, tuple[bytes, float]] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def _key(wrapped: bytes, context: dict[str, str]) -> str:
        digest = hashlib.sha256(wrapped)
        for item in sorted(context.items()):
            digest.update(f"{item[0]}={item[1]};".encode())
        return digest.hexdigest()

    def get(self, wrapped: bytes, context: dict[str, str]) -> bytes | None:
        now = time.monotonic()
        key = self._key(wrapped, context)
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            plaintext, expires = entry
            if expires <= now:
                self._data.pop(key, None)
                return None
            self._data.move_to_end(key)
            return plaintext

    def put(self, wrapped: bytes, context: dict[str, str], plaintext: bytes) -> None:
        now = time.monotonic()
        key = self._key(wrapped, context)
        with self._lock:
            self._data[key] = (plaintext, now + self._ttl)
            self._data.move_to_end(key)
            while len(self._data) > self._max:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


# ------------------------------------------------------------------- aws kms
class AwsKmsKeyProvider:
    """Envelope encryption backed by AWS KMS.

    The CMK never leaves KMS. Each enrolment mints a fresh 256-bit DEK via
    ``GenerateDataKey``; the wrapped copy is stored beside the ciphertext and
    the plaintext copy is discarded as soon as the seal completes.

    The **encryption context** is the part worth understanding. It is
    additional authenticated data for the KMS operation itself: a decrypt whose
    context does not match the encrypt is refused *by KMS*, in the account's
    CloudTrail log, before this service ever sees a key. Binding the employee
    identifier into it means a stolen wrapped DEK cannot be unwrapped in the
    service of a different employee, and every unwrap is attributable.
    """

    def __init__(
        self,
        key_id: str,
        *,
        region: str,
        client: Any | None = None,
        cache_ttl_s: int = 300,
    ) -> None:
        if not key_id:
            raise ConfigError("PNSM_KMS_KEY_ID must be set when the KMS key provider is selected")
        self._key_id = key_id
        self._region = region
        self._client = client or self._build_client(region)
        self._cache = _DekCache(ttl_s=cache_ttl_s)

    @staticmethod
    def _build_client(region: str) -> Any:
        import boto3
        from botocore.config import Config

        return boto3.client(
            "kms",
            region_name=region,
            config=Config(
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=3,
                read_timeout=5,
            ),
        )

    @property
    def name(self) -> str:
        return PROVIDER_KMS

    @property
    def active_key_id(self) -> str:
        """The CMK ARN. Under envelope encryption the *data* key is fresh every
        time, so the stable identifier is the master key that wraps it."""
        return self._key_id

    def data_key_for_encrypt(self, context: dict[str, str]) -> DataKey:
        try:
            response = self._client.generate_data_key(
                KeyId=self._key_id, KeySpec="AES_256", EncryptionContext=context
            )
        except Exception as exc:
            raise KeyUnavailableError(f"KMS GenerateDataKey failed: {exc}") from exc

        plaintext = bytes(response["Plaintext"])
        wrapped = bytes(response["CiphertextBlob"])
        if len(plaintext) != SECRET_LEN:
            raise KeyUnavailableError(
                f"KMS returned a {len(plaintext)}-byte data key, expected {SECRET_LEN}"
            )
        # Cache immediately: the very next operation on this envelope is a read.
        self._cache.put(wrapped, context, plaintext)
        return DataKey(plaintext=plaintext, key_id=self._key_id, wrapped=wrapped)

    def data_key_for_decrypt(
        self, key_id: str, wrapped: bytes | None, context: dict[str, str]
    ) -> bytes:
        if wrapped is None:
            raise KeyUnavailableError(
                "envelope was sealed with the KMS provider but carries no wrapped data key"
            )
        cached = self._cache.get(wrapped, context)
        if cached is not None:
            return cached

        try:
            response = self._client.decrypt(
                CiphertextBlob=wrapped, EncryptionContext=context, KeyId=key_id or self._key_id
            )
        except Exception as exc:
            # Covers a tampered blob, a mismatched encryption context, a revoked
            # grant and a network failure alike. All are "cannot open".
            raise KeyUnavailableError(f"KMS Decrypt failed: {exc}") from exc

        plaintext = bytes(response["Plaintext"])
        self._cache.put(wrapped, context, plaintext)
        return plaintext

    def clear_cache(self) -> None:
        self._cache.clear()


# ------------------------------------------------------------------- factory
def build_key_provider(settings: Settings, *, client: Any | None = None) -> KeyProvider:
    """Select the provider named by ``PNSM_KEY_PROVIDER``."""
    provider = settings.key_provider.lower()
    if provider == PROVIDER_KMS:
        log.info("field encryption: AWS KMS envelope encryption, key=%s", settings.kms_key_id)
        return AwsKmsKeyProvider(
            settings.kms_key_id,
            region=settings.aws_region,
            client=client,
            cache_ttl_s=settings.kms_dek_cache_ttl_s,
        )
    if provider == PROVIDER_STATIC:
        if settings.app_env not in ("local", "test"):
            log.warning(
                "field encryption: static keys from the environment in a %s deployment. "
                "The master plan requires AWS KMS; set PNSM_KEY_PROVIDER=kms.",
                settings.app_env,
            )
        return StaticKeyProvider(settings.fle_keys, settings.fle_active_key)
    raise ConfigError(
        f"PNSM_KEY_PROVIDER must be {PROVIDER_KMS!r} or {PROVIDER_STATIC!r}, got {provider!r}"
    )


def generate_local_key() -> str:
    """A base64 32-byte key, for ``scripts/gen_keys.py`` and tests."""
    return base64.b64encode(os.urandom(SECRET_LEN)).decode("ascii")
