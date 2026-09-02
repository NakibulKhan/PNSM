"""PIN hashing and verification with lockout (FR-06).

Lockout state lives here rather than in Person 3's backend on purpose: the
counter and the comparison must be adjacent, or a race between two concurrent
attempts can spend one budget twice.

Reference: blueprint section 06.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.crypto import pin as pinmod
from app.errors import PnsmError, ReasonCode
from app.security.lockout import LockoutPolicy
from app.storage import keys as keymod

log = logging.getLogger(__name__)


class PinService:
    """Hash and check employee PINs."""

    def __init__(self, settings: Settings, lockout: LockoutPolicy) -> None:
        self._settings = settings
        self._lockout = lockout

    def hash_pin(self, *, user_ref: str, pin: str) -> dict[str, Any]:
        keymod.validate_user_ref(user_ref)
        try:
            record = pinmod.hash_pin(pin, self._settings)
        except pinmod.PinPolicyError as exc:
            # The message is written for the HR user setting the PIN, so it is
            # the one error here that is safe to surface verbatim.
            raise PnsmError(ReasonCode.BAD_REQUEST, detail=str(exc), extra={"policy": str(exc)}) from exc
        log.info("pin set user_ref=%s cost=%d", user_ref, record["cost"])
        return record

    def verify_pin(self, *, user_ref: str, pin: str, pin_hash: str) -> dict[str, Any]:
        keymod.validate_user_ref(user_ref)

        state = self._lockout.status(user_ref)
        if state.locked:
            # No comparison is attempted while locked: doing the bcrypt work
            # anyway would let an attacker keep probing through the lockout.
            raise PnsmError(
                ReasonCode.RATE_LIMITED,
                detail=f"{user_ref} locked for {state.retry_after_s}s",
                extra=state.as_dict(),
            )

        if pinmod.verify_pin(pin, pin_hash, self._settings):
            cleared = self._lockout.register_success(user_ref)
            return {"match": True, **cleared.as_dict()}

        failed = self._lockout.register_failure(user_ref)
        log.warning(
            "pin mismatch user_ref=%s attempts_left=%d locked=%s",
            user_ref,
            failed.attempts_left,
            failed.locked,
        )
        return {"match": False, **failed.as_dict()}

    def status(self, *, user_ref: str) -> dict[str, Any]:
        keymod.validate_user_ref(user_ref)
        return self._lockout.status(user_ref).as_dict()
