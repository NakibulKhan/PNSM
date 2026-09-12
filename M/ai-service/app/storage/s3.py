"""Amazon S3 object storage.

One interface, two backends: MinIO for local development, Amazon S3 in every
deployed environment.  ``boto3`` takes an optional ``endpoint_url``, so the
difference is one environment variable and zero lines of code.

Two deliberate decisions worth stating, because both look like omissions:

**Selfies are not served through CloudFront.** The master plan puts CloudFront
in front of the platform for "edge-cached CDN delivery", and that is right --
for Person 2's compiled SPA, which is public, immutable and latency-sensitive.
Check-in selfies are none of those things. They are personal data with a
90-day retention rule, read a handful of times by one HR user, and putting them
behind an edge cache spreads copies across points of presence for no gain. They
stay in a private bucket reached by short-lived presigned URLs. The CloudFront
distribution this module's sibling config describes is the *frontend* one.

**Encryption at rest is a bucket policy, not a signed header.** S3 can take
``ServerSideEncryption`` as a signed parameter on a presigned PUT, but then the
mobile client must echo the matching ``x-amz-server-side-encryption`` headers
exactly or the upload is rejected -- a fragile contract across two codebases.
Default bucket encryption achieves the same result unconditionally, including
for any object written by a path this service does not control.
:func:`verify_bucket_encryption` checks it is actually on, because a policy
nobody verifies is a policy that silently is not there.

Reference: master plan, Quadrant IV -- AWS infrastructure and OWASP A02.
"""

from __future__ import annotations

import datetime as _dt
import logging
from typing import Any, Protocol

from app.config import Settings
from app.errors import PnsmError, ReasonCode
from app.storage import keys as keymod

log = logging.getLogger(__name__)


class ObjectStore(Protocol):
    """Everything the service needs from a bucket."""

    def get_object(self, key: str, *, max_bytes: int) -> bytes: ...

    def presign_put(
        self, key: str, *, content_type: str, content_length: int, ttl_s: int
    ) -> dict[str, Any]: ...

    def presign_get(self, key: str, *, ttl_s: int) -> dict[str, Any]: ...


def _expires_at(ttl_s: int) -> str:
    stamp = _dt.datetime.now(_dt.UTC) + _dt.timedelta(seconds=ttl_s)
    return stamp.isoformat().replace("+00:00", "Z")


class S3ObjectStore:
    """boto3-backed store. Targets Amazon S3, and MinIO when an endpoint is set."""

    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        self._settings = settings
        self._bucket = settings.s3_bucket
        self._client = client or self._build_client(settings)

    @staticmethod
    def _build_client(settings: Settings) -> Any:
        import boto3
        from botocore.config import Config

        custom_endpoint = bool(settings.s3_endpoint)
        kwargs: dict[str, Any] = {
            "region_name": settings.aws_region,
            "config": Config(
                # SigV4 everywhere: required by newer S3 regions and by MinIO.
                signature_version="s3v4",
                # Virtual-host addressing is the AWS default and the only style
                # new buckets support; MinIO needs path style.
                s3={"addressing_style": "path" if custom_endpoint else "virtual"},
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=3,
                read_timeout=5,
            ),
        }
        if custom_endpoint:
            kwargs["endpoint_url"] = settings.s3_endpoint
        # Credentials are omitted on ECS so boto3 picks up the task role. A
        # static pair is only ever set for local MinIO.
        if settings.s3_access_key_id:
            kwargs["aws_access_key_id"] = settings.s3_access_key_id
            kwargs["aws_secret_access_key"] = settings.s3_secret_access_key
        return boto3.client("s3", **kwargs)

    # -------------------------------------------------------------- reading
    def get_object(self, key: str, *, max_bytes: int) -> bytes:
        keymod.require_managed_key(key)
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=key)
            size = int(head.get("ContentLength", 0))
            # Checked before the body is read: refusing a 50 MB object after
            # streaming it into memory would defeat the purpose.
            if size > max_bytes:
                raise PnsmError(
                    ReasonCode.PAYLOAD_TOO_LARGE,
                    detail=f"object {key} is {size} bytes, ceiling is {max_bytes}",
                )
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return bytes(response["Body"].read(max_bytes + 1))
        except PnsmError:
            raise
        except Exception as exc:
            log.warning("object fetch failed key=%s error=%s", key, exc)
            raise PnsmError(
                ReasonCode.UPSTREAM_STORAGE_ERROR, detail=f"could not fetch {key}: {exc}"
            ) from exc

    # ------------------------------------------------------------ presigning
    def presign_put(
        self, key: str, *, content_type: str, content_length: int, ttl_s: int
    ) -> dict[str, Any]:
        """Short-lived upload URL with the content type and exact length signed.

        Signing ``ContentLength`` rather than relying on a policy range means
        the bucket itself rejects an oversized upload: the ceiling is enforced
        by infrastructure, not by the client behaving.
        """
        keymod.require_managed_key(key)
        url = self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": content_length,
            },
            ExpiresIn=ttl_s,
            HttpMethod="PUT",
        )
        return {
            "upload_url": url,
            "method": "PUT",
            "headers": {"Content-Type": content_type, "Content-Length": str(content_length)},
            "object_key": key,
            "expires_at": _expires_at(ttl_s),
            "max_bytes": content_length,
        }

    def presign_get(self, key: str, *, ttl_s: int) -> dict[str, Any]:
        keymod.require_managed_key(key)
        url = self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=ttl_s,
            HttpMethod="GET",
        )
        return {
            "download_url": url,
            "method": "GET",
            "object_key": key,
            "expires_at": _expires_at(ttl_s),
        }

    # ------------------------------------------------------------- posture
    def verify_bucket_encryption(self) -> dict[str, Any]:
        """Report the bucket's default encryption rule.

        Called at readiness and by the provisioning script. A bucket whose
        default encryption quietly reverted is indistinguishable from a
        correct one until somebody reads the objects.
        """
        try:
            response = self._client.get_bucket_encryption(Bucket=self._bucket)
        except Exception as exc:
            return {"encrypted": False, "algorithm": None, "error": str(exc)}

        rules = response.get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
        for rule in rules:
            default = rule.get("ApplyServerSideEncryptionByDefault", {})
            algorithm = default.get("SSEAlgorithm")
            if algorithm:
                return {
                    "encrypted": True,
                    "algorithm": algorithm,
                    "kms_key": default.get("KMSMasterKeyID"),
                    "bucket_key_enabled": rule.get("BucketKeyEnabled", False),
                }
        return {"encrypted": False, "algorithm": None, "error": "no default encryption rule"}

    def verify_public_access_blocked(self) -> dict[str, Any]:
        """Report the bucket's public-access block. OWASP A01 and A02."""
        try:
            response = self._client.get_public_access_block(Bucket=self._bucket)
        except Exception as exc:
            return {"blocked": False, "error": str(exc)}
        config = response.get("PublicAccessBlockConfiguration", {})
        every = all(
            config.get(flag, False)
            for flag in (
                "BlockPublicAcls",
                "IgnorePublicAcls",
                "BlockPublicPolicy",
                "RestrictPublicBuckets",
            )
        )
        return {"blocked": every, "config": config}


class InMemoryObjectStore:
    """Test double. Holds objects in a dict and mints well-formed fake URLs."""

    def __init__(self, *, base_url: str = "https://memory.invalid") -> None:
        self.objects: dict[str, bytes] = {}
        self._base = base_url

    def put(self, key: str, payload: bytes) -> None:
        self.objects[key] = payload

    def get_object(self, key: str, *, max_bytes: int) -> bytes:
        keymod.require_managed_key(key)
        try:
            payload = self.objects[key]
        except KeyError as exc:
            raise PnsmError(
                ReasonCode.UPSTREAM_STORAGE_ERROR, detail=f"no such object {key}"
            ) from exc
        if len(payload) > max_bytes:
            raise PnsmError(
                ReasonCode.PAYLOAD_TOO_LARGE,
                detail=f"object {key} is {len(payload)} bytes, ceiling is {max_bytes}",
            )
        return payload

    def presign_put(
        self, key: str, *, content_type: str, content_length: int, ttl_s: int
    ) -> dict[str, Any]:
        keymod.require_managed_key(key)
        return {
            "upload_url": f"{self._base}/{key}?sig=test",
            "method": "PUT",
            "headers": {"Content-Type": content_type, "Content-Length": str(content_length)},
            "object_key": key,
            "expires_at": _expires_at(ttl_s),
            "max_bytes": content_length,
        }

    def presign_get(self, key: str, *, ttl_s: int) -> dict[str, Any]:
        keymod.require_managed_key(key)
        return {
            "download_url": f"{self._base}/{key}?sig=test",
            "method": "GET",
            "object_key": key,
            "expires_at": _expires_at(ttl_s),
        }

    def verify_bucket_encryption(self) -> dict[str, Any]:
        return {"encrypted": True, "algorithm": "in-memory", "kms_key": None}

    def verify_public_access_blocked(self) -> dict[str, Any]:
        return {"blocked": True, "config": {}}


def build_object_store(settings: Settings, *, client: Any | None = None) -> ObjectStore:
    """Construct the configured store; memory only under the test environment."""
    if settings.app_env == "test" and client is None:
        return InMemoryObjectStore()
    return S3ObjectStore(settings, client=client)
