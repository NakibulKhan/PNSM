"""Two-factor PIN protection (FR-06).

bcrypt alone does not protect a short numeric PIN.  It protects a *stolen
database*; it does nothing against online guessing of a 10^6 space, and the
attacker who matters here already holds a valid session.  So bcrypt is one of
four layers:

1. a server-side pepper, so a leaked database is useless without the env;
2. bcrypt with a cost benchmarked against the deployed instance;
3. a six-digit minimum with weak-PIN rejection at onboarding;
4. per-user lockout -- which is the layer that actually stops guessing.

Reference: blueprint sections 00 (correction 3) and 06.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from typing import Any, Final

import bcrypt

from app.config import Settings

ALGORITHM: Final[str] = "bcrypt-hmac-sha256-pepper"
_DIGITS_RE: Final[re.Pattern[str]] = re.compile(r"^\d+$")

#: PINs that are common enough to be tried first in any online attack.
_BLOCKLIST: Final[frozenset[str]] = frozenset(
    {
        "000000", "111111", "222222", "333333", "444444", "555555",
        "666666", "777777", "888888", "999999", "123456", "654321",
        "121212", "112233", "123123", "696969", "159753", "147258",
        "0000", "1111", "1234", "4321", "1212", "7777", "2580", "1004",
        "1122", "1313", "2001", "1010", "2020",
    }
)


class PinPolicyError(ValueError):
    """The PIN does not meet policy. Raised at onboarding, never at check-in."""


def _is_sequential(pin: str) -> bool:
    """True for runs like 123456 or 987654 (step +1 or -1 throughout)."""
    if len(pin) < 3:
        return False
    deltas = {int(pin[i + 1]) - int(pin[i]) for i in range(len(pin) - 1)}
    return deltas in ({1}, {-1})


def _is_repeated(pin: str) -> bool:
    """True when the PIN is one digit repeated, or one short block repeated."""
    if len(set(pin)) == 1:
        return True
    for block in (2, 3):
        if len(pin) % block == 0 and len(pin) > block:
            chunk = pin[:block]
            if chunk * (len(pin) // block) == pin:
                return True
    return False


def validate_pin_policy(pin: str, settings: Settings) -> str:
    """Check a candidate PIN and return it normalised.

    Raises:
        PinPolicyError: with a message safe to show the HR user setting the PIN.
    """
    if not isinstance(pin, str):
        raise PinPolicyError("PIN must be a string of digits.")
    candidate = pin.strip()
    if not _DIGITS_RE.match(candidate):
        raise PinPolicyError("PIN must contain digits only.")
    if len(candidate) < settings.pin_min_length:
        raise PinPolicyError(f"PIN must be at least {settings.pin_min_length} digits.")
    if len(candidate) > settings.pin_max_length:
        raise PinPolicyError(f"PIN must be at most {settings.pin_max_length} digits.")
    if candidate in _BLOCKLIST:
        raise PinPolicyError("That PIN is too common. Choose another.")
    if _is_repeated(candidate):
        raise PinPolicyError("PIN must not be a repeated digit or pattern.")
    if _is_sequential(candidate):
        raise PinPolicyError("PIN must not be a sequential run of digits.")
    return candidate


def derive_material(pin: str, pepper: bytes) -> bytes:
    """Peppered pre-hash fed to bcrypt.

    HMAC-SHA256 gives a fixed 32-byte digest; base64 makes it 44 printable
    bytes, comfortably inside bcrypt's 72-byte input limit (a longer encoding
    would be silently truncated, which is the classic way to weaken this).
    """
    digest = hmac.new(pepper, pin.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest)


def hash_pin(pin: str, settings: Settings, *, enforce_policy: bool = True) -> dict[str, Any]:
    """Hash a PIN for storage on the employee document.

    Returns a dict Person 3 stores verbatim. The plaintext PIN is never
    returned, logged, or retained.
    """
    candidate = validate_pin_policy(pin, settings) if enforce_policy else pin
    material = derive_material(candidate, settings.pin_pepper)
    hashed = bcrypt.hashpw(material, bcrypt.gensalt(rounds=settings.bcrypt_cost))
    return {
        "pin_hash": hashed.decode("ascii"),
        "algo": ALGORITHM,
        "cost": settings.bcrypt_cost,
        "pepper_version": settings.pin_pepper_version,
    }


def verify_pin(pin: str, pin_hash: str, settings: Settings) -> bool:
    """Constant-time check of a submitted PIN against the stored hash.

    Never raises on a wrong PIN -- a malformed stored hash returns ``False`` so
    that a corrupt record cannot be distinguished from a wrong PIN by timing or
    by status code.
    """
    if not isinstance(pin, str) or not isinstance(pin_hash, str) or not pin_hash:
        return False
    if not _DIGITS_RE.match(pin.strip()):
        return False
    material = derive_material(pin.strip(), settings.pin_pepper)
    try:
        return bool(bcrypt.checkpw(material, pin_hash.encode("ascii")))
    except (ValueError, TypeError):
        return False


def benchmark_cost(settings: Settings, cost: int, rounds: int = 3) -> float:
    """Average seconds per ``hashpw`` at a given cost, on *this* machine.

    Used by ``scripts/bench_bcrypt.py``. Run it on the deployed container, not
    on a laptop: half a shared vCPU is several times slower.
    """
    import time

    material = derive_material("135790", settings.pin_pepper)
    start = time.perf_counter()
    for _ in range(rounds):
        bcrypt.hashpw(material, bcrypt.gensalt(rounds=cost))
    return (time.perf_counter() - start) / rounds
