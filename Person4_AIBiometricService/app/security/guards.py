"""Device integrity, freshness and replay guards.

FR-05 covers mock GPS.  Three attacks it does not cover are cheap to close and
are exactly what a sharp examiner asks about:

* a selfie taken inside the geofence at 09:00 and submitted from home at noon;
* the same request replayed after a network retry, or by an attacker;
* the same saved photograph submitted every morning.

**Trust boundary.** Every device signal below is self-reported by the client. A
rooted phone can strip ``is_mock_location`` before the request leaves. These
controls raise the cost of casual cheating; they do not stop a determined
attacker. The honest production path is Play Integrity (Android) and
DeviceCheck/App Attest (iOS), which produce a server-verifiable attestation.
That limitation is stated in ``docs/SECURITY.md`` rather than papered over.

Reference: blueprint section 07.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Final

from app.errors import PnsmError, ReasonCode
from app.security.stores import InMemoryTTLStore, RecentValues, SlidingWindowRateLimiter

log = logging.getLogger(__name__)

#: Crockford base32, 26 characters -- the ULID alphabet. Validating the shape
#: locally means we never need a ULID dependency just to reject junk.
_ULID_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


@dataclass(frozen=True)
class DeviceContext:
    """Client-reported device state accompanying a check-in."""

    platform: str = "unknown"
    os_version: str = ""
    app_version: str = ""
    is_mock_location: bool = False
    is_emulator: bool = False
    is_rooted: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform,
            "os_version": self.os_version,
            "app_version": self.app_version,
            "is_mock_location": self.is_mock_location,
            "is_emulator": self.is_emulator,
            "is_rooted": self.is_rooted,
        }


def is_valid_ulid(value: str) -> bool:
    return bool(_ULID_RE.match(value or ""))


def image_fingerprint(payload: bytes) -> str:
    """Stable identifier for an image payload."""
    return hashlib.sha256(payload).hexdigest()


class SecurityGuards:
    """All pre-inference checks, in the order they should run.

    Ordering is deliberate and load-bearing: the cheap, decisive checks run
    before the expensive ones, so a spoofed request never reaches the model.
    """

    def __init__(
        self,
        *,
        max_clock_skew_s: int,
        nonce_ttl_s: int,
        image_replay_window: int,
        rate_limit_per_min: int,
    ) -> None:
        self._max_skew = max_clock_skew_s
        self._nonce_ttl = nonce_ttl_s
        self._nonces = InMemoryTTLStore()
        self._images = RecentValues(window=image_replay_window)
        self._rate = SlidingWindowRateLimiter(limit=rate_limit_per_min, window_s=60)

    # ------------------------------------------------------------------ device
    def check_device(self, device: DeviceContext) -> None:
        """Reject spoofed location and emulated devices before any work is done."""
        if device.is_mock_location:
            raise PnsmError(
                ReasonCode.MOCK_LOCATION, detail=f"mock location reported by {device.platform}"
            )
        if device.is_emulator:
            raise PnsmError(
                ReasonCode.EMULATOR_DETECTED, detail=f"emulator reported by {device.platform}"
            )
        # A rooted device is logged but not blocked: rooting is legal, common,
        # and blocking it would lock out legitimate employees for a signal that
        # a real attacker would simply suppress.
        if device.is_rooted:
            log.warning("check-in from a rooted device platform=%s", device.platform)

    # ---------------------------------------------------------------- freshness
    def check_freshness(self, captured_at: _dt.datetime, *, now: _dt.datetime | None = None) -> float:
        """Reject a capture that is too old to be this check-in.

        Returns the measured skew in seconds so callers can log it.
        """
        current = now or _dt.datetime.now(_dt.UTC)
        if captured_at.tzinfo is None:
            captured_at = captured_at.replace(tzinfo=_dt.UTC)
        skew = (current - captured_at.astimezone(_dt.UTC)).total_seconds()
        # A capture from the future by more than the window means a wrong device
        # clock, which is just as suspect as a stale one.
        if abs(skew) > self._max_skew:
            raise PnsmError(
                ReasonCode.STALE_CAPTURE,
                detail=f"capture skew {skew:.0f}s exceeds +/-{self._max_skew}s",
            )
        return skew

    # -------------------------------------------------------------------- nonce
    def check_request_id(self, request_id: str) -> None:
        """Enforce single use of a request id.

        Also makes ``/v1/verify`` idempotent under mobile network retries, which
        the reliability requirement demands anyway ("failed check-ins must not
        create duplicate or corrupted attendance records").
        """
        if not is_valid_ulid(request_id):
            raise PnsmError(
                ReasonCode.BAD_REQUEST, detail="request_id must be a 26-character ULID"
            )
        if not self._nonces.add_if_absent(request_id, self._nonce_ttl):
            raise PnsmError(ReasonCode.REPLAY_DETECTED, detail=f"request_id {request_id} reused")

    # ------------------------------------------------------------- image replay
    def check_image_replay(self, user_ref: str, payload: bytes) -> str:
        """Reject a byte-identical selfie already used by this employee.

        Returns the fingerprint so it can be recorded on the attendance log.
        """
        digest = image_fingerprint(payload)
        if self._images.seen_or_add(user_ref, digest):
            raise PnsmError(
                ReasonCode.REPLAY_DETECTED,
                detail=f"image {digest[:12]} already used by {user_ref}",
            )
        return digest

    # --------------------------------------------------------------- rate limit
    def check_rate(self, user_ref: str) -> None:
        if not self._rate.allow(user_ref):
            raise PnsmError(ReasonCode.RATE_LIMITED, detail=f"rate limit hit for {user_ref}")

    def reset(self) -> None:
        """Clear all state. Tests only."""
        self._nonces.clear()
        self._images.clear()
        self._rate.clear()
