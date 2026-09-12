"""Device integrity, freshness and replay guards."""

from __future__ import annotations

import datetime as _dt

import pytest

from app.errors import PnsmError, ReasonCode
from app.security.guards import DeviceContext, SecurityGuards, image_fingerprint, is_valid_ulid
from tests.helpers import ULID_A, ULID_B, synthetic_jpeg, utcnow


def make_guards(**overrides) -> SecurityGuards:
    base = {
        "max_clock_skew_s": 120,
        "nonce_ttl_s": 600,
        "image_replay_window": 30,
        "rate_limit_per_min": 60,
    }
    base.update(overrides)
    return SecurityGuards(**base)


# ----------------------------------------------------------------- device
def test_mock_location_is_rejected_before_any_work() -> None:
    with pytest.raises(PnsmError) as caught:
        make_guards().check_device(DeviceContext(platform="android", is_mock_location=True))
    assert caught.value.code is ReasonCode.MOCK_LOCATION
    assert caught.value.http_status == 403


def test_emulator_is_rejected() -> None:
    with pytest.raises(PnsmError) as caught:
        make_guards().check_device(DeviceContext(platform="android", is_emulator=True))
    assert caught.value.code is ReasonCode.EMULATOR_DETECTED


def test_rooted_device_is_logged_but_allowed() -> None:
    """Rooting is legal and common; blocking it locks out honest employees for
    a signal a real attacker would simply suppress."""
    make_guards().check_device(DeviceContext(platform="android", is_rooted=True))


def test_clean_device_passes() -> None:
    make_guards().check_device(DeviceContext(platform="ios"))


# -------------------------------------------------------------- freshness
def test_recent_capture_passes() -> None:
    guards = make_guards()
    skew = guards.check_freshness(utcnow() - _dt.timedelta(seconds=5))
    assert 0 <= skew < 10


def test_stale_capture_is_rejected() -> None:
    with pytest.raises(PnsmError) as caught:
        make_guards().check_freshness(utcnow() - _dt.timedelta(seconds=600))
    assert caught.value.code is ReasonCode.STALE_CAPTURE


def test_future_capture_is_rejected() -> None:
    """A device clock far ahead is as suspect as one far behind."""
    with pytest.raises(PnsmError) as caught:
        make_guards().check_freshness(utcnow() + _dt.timedelta(seconds=600))
    assert caught.value.code is ReasonCode.STALE_CAPTURE


def test_naive_datetime_is_treated_as_utc() -> None:
    guards = make_guards()
    naive = _dt.datetime.now(_dt.UTC).replace(tzinfo=None)
    guards.check_freshness(naive)


# ------------------------------------------------------------------ nonce
def test_first_request_id_is_accepted_and_the_second_is_not() -> None:
    guards = make_guards()
    guards.check_request_id(ULID_A)
    with pytest.raises(PnsmError) as caught:
        guards.check_request_id(ULID_A)
    assert caught.value.code is ReasonCode.REPLAY_DETECTED
    assert caught.value.http_status == 409


def test_distinct_request_ids_are_independent() -> None:
    guards = make_guards()
    guards.check_request_id(ULID_A)
    guards.check_request_id(ULID_B)


def test_malformed_request_id_is_a_bad_request() -> None:
    with pytest.raises(PnsmError) as caught:
        make_guards().check_request_id("not-a-ulid")
    assert caught.value.code is ReasonCode.BAD_REQUEST


def test_ulid_validation_rejects_the_excluded_alphabet() -> None:
    assert is_valid_ulid(ULID_A)
    # Crockford base32 excludes I, L, O and U to avoid transcription errors.
    assert not is_valid_ulid("01JB7ZQ2K8N4V0X6M3PYE9TSRI")
    assert not is_valid_ulid("01JB7ZQ2K8N4V0X6M3PYE9TSR")  # 25 chars
    assert not is_valid_ulid("")


# ---------------------------------------------------------- image replay
def test_reused_image_is_rejected_for_the_same_employee() -> None:
    guards = make_guards()
    payload = synthetic_jpeg(1)
    digest = guards.check_image_replay("alice", payload)
    assert digest == image_fingerprint(payload)
    with pytest.raises(PnsmError) as caught:
        guards.check_image_replay("alice", payload)
    assert caught.value.code is ReasonCode.REPLAY_DETECTED


def test_the_same_image_from_another_employee_is_allowed() -> None:
    """History is per employee; a shared office backdrop is not an attack."""
    guards = make_guards()
    payload = synthetic_jpeg(2)
    guards.check_image_replay("alice", payload)
    guards.check_image_replay("bob", payload)


def test_image_history_is_bounded_and_forgets() -> None:
    guards = make_guards(image_replay_window=3)
    first = synthetic_jpeg(10)
    guards.check_image_replay("alice", first)
    for seed in (11, 12, 13):
        guards.check_image_replay("alice", synthetic_jpeg(seed))
    # The window has rolled past the first image, so it is accepted again.
    guards.check_image_replay("alice", first)


def test_image_replay_can_be_disabled() -> None:
    guards = make_guards(image_replay_window=0)
    payload = synthetic_jpeg(3)
    guards.check_image_replay("alice", payload)
    guards.check_image_replay("alice", payload)


# ------------------------------------------------------------ rate limit
def test_rate_limit_trips_after_the_budget() -> None:
    guards = make_guards(rate_limit_per_min=3)
    for _ in range(3):
        guards.check_rate("alice")
    with pytest.raises(PnsmError) as caught:
        guards.check_rate("alice")
    assert caught.value.code is ReasonCode.RATE_LIMITED
    assert caught.value.http_status == 429


def test_rate_limit_is_per_employee() -> None:
    guards = make_guards(rate_limit_per_min=2)
    guards.check_rate("alice")
    guards.check_rate("alice")
    guards.check_rate("bob")
