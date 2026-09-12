"""PIN policy, peppering and lockout integration.

Requires the real ``bcrypt`` package: the point of these tests is that the
production key-derivation path works, so stubbing it would defeat them.
"""

from __future__ import annotations

import pytest

from app.crypto import pin as pinmod
from app.errors import PnsmError, ReasonCode
from app.security.lockout import LockoutPolicy
from app.services.pin_service import PinService
from tests.helpers import make_settings

GOOD_PIN = "418362"


def _service(**overrides) -> tuple[PinService, object]:
    settings = make_settings(**overrides)
    policy = LockoutPolicy(
        max_attempts=settings.pin_max_attempts, lockout_seconds=settings.pin_lockout_seconds
    )
    return PinService(settings, policy), settings


# ----------------------------------------------------------------- policy
def test_a_good_pin_is_accepted() -> None:
    settings = make_settings()
    assert pinmod.validate_pin_policy(GOOD_PIN, settings) == GOOD_PIN


def test_short_pins_are_rejected() -> None:
    settings = make_settings(pin_min_length=6)
    with pytest.raises(pinmod.PinPolicyError):
        pinmod.validate_pin_policy("4183", settings)


def test_non_digits_are_rejected() -> None:
    settings = make_settings()
    for bad in ("41a362", "4183 2", "", "------"):
        with pytest.raises(pinmod.PinPolicyError):
            pinmod.validate_pin_policy(bad, settings)


def test_common_pins_are_rejected() -> None:
    settings = make_settings()
    for bad in ("123456", "000000", "111111", "654321"):
        with pytest.raises(pinmod.PinPolicyError):
            pinmod.validate_pin_policy(bad, settings)


def test_repeated_and_sequential_patterns_are_rejected() -> None:
    settings = make_settings()
    for bad in ("222222", "121212", "123123", "345678", "876543"):
        with pytest.raises(pinmod.PinPolicyError):
            pinmod.validate_pin_policy(bad, settings)


# ------------------------------------------------------------------ hash
def test_hashing_then_verifying_round_trips() -> None:
    settings = make_settings()
    record = pinmod.hash_pin(GOOD_PIN, settings)
    assert pinmod.verify_pin(GOOD_PIN, record["pin_hash"], settings)
    assert not pinmod.verify_pin("418363", record["pin_hash"], settings)


def test_the_plaintext_pin_never_appears_in_the_record() -> None:
    record = pinmod.hash_pin(GOOD_PIN, make_settings())
    assert GOOD_PIN not in str(record)


def test_the_same_pin_hashes_differently_each_time() -> None:
    """bcrypt salts per call; identical hashes would leak equal PINs."""
    settings = make_settings()
    first = pinmod.hash_pin(GOOD_PIN, settings)["pin_hash"]
    second = pinmod.hash_pin(GOOD_PIN, settings)["pin_hash"]
    assert first != second


def test_the_pepper_makes_a_stolen_database_useless() -> None:
    """A hash made under one pepper must not verify under another."""
    import base64

    original = make_settings()
    attacker = make_settings(pin_pepper_raw=base64.b64encode(b"\x77" * 32).decode())
    record = pinmod.hash_pin(GOOD_PIN, original)
    assert pinmod.verify_pin(GOOD_PIN, record["pin_hash"], original)
    assert not pinmod.verify_pin(GOOD_PIN, record["pin_hash"], attacker)


def test_the_peppered_material_fits_inside_bcrypts_input_limit() -> None:
    """Over 72 bytes bcrypt silently truncates, which would weaken the scheme."""
    material = pinmod.derive_material(GOOD_PIN, make_settings().pin_pepper)
    assert len(material) == 44
    assert len(material) < 72


def test_a_corrupt_stored_hash_returns_false_rather_than_raising() -> None:
    """A broken record must be indistinguishable from a wrong PIN."""
    settings = make_settings()
    for bad in ("", "not-a-hash", "$2b$04$short"):
        assert pinmod.verify_pin(GOOD_PIN, bad, settings) is False


def test_the_record_documents_its_own_parameters() -> None:
    record = pinmod.hash_pin(GOOD_PIN, make_settings(bcrypt_cost=5))
    assert record["algo"] == pinmod.ALGORITHM
    assert record["cost"] == 5
    assert record["pepper_version"]


# --------------------------------------------------------------- lockout
def test_a_correct_pin_reports_a_match() -> None:
    service, settings = _service()
    record = pinmod.hash_pin(GOOD_PIN, settings)
    result = service.verify_pin(user_ref="alice", pin=GOOD_PIN, pin_hash=record["pin_hash"])
    assert result["match"] is True
    assert result["locked"] is False


def test_wrong_pins_burn_the_budget_then_lock() -> None:
    service, settings = _service(pin_max_attempts=3)
    record = pinmod.hash_pin(GOOD_PIN, settings)
    for _ in range(2):
        assert service.verify_pin(user_ref="alice", pin="999111", pin_hash=record["pin_hash"])["match"] is False
    final = service.verify_pin(user_ref="alice", pin="999111", pin_hash=record["pin_hash"])
    assert final["locked"] is True

    # Once locked, no comparison is attempted at all.
    with pytest.raises(PnsmError) as caught:
        service.verify_pin(user_ref="alice", pin=GOOD_PIN, pin_hash=record["pin_hash"])
    assert caught.value.code is ReasonCode.RATE_LIMITED


def test_a_policy_violation_surfaces_a_message_hr_can_act_on() -> None:
    service, _ = _service()
    with pytest.raises(PnsmError) as caught:
        service.hash_pin(user_ref="alice", pin="123456")
    assert caught.value.code is ReasonCode.BAD_REQUEST
    assert "common" in str(caught.value.detail).lower()
