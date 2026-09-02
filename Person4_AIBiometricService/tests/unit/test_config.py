"""Configuration validation -- the fail-loud contract."""

from __future__ import annotations

import base64
import json

import pytest
from pydantic import ValidationError

from app.config import ConfigError, Settings
from tests.helpers import CALIBRATION_PATH, TEST_FLE_KEY, TEST_HMAC, TEST_PEPPER, make_settings


def test_a_valid_configuration_starts_and_reports_no_fatal_warnings() -> None:
    settings = make_settings()
    warnings = settings.validate_startup()
    assert isinstance(warnings, list)


def test_a_missing_encryption_key_refuses_to_start() -> None:
    settings = make_settings(fle_keys_raw="")
    with pytest.raises(ConfigError) as caught:
        settings.validate_startup()
    assert "PNSM_FLE_KEYS" in str(caught.value)


def test_a_missing_pepper_refuses_to_start() -> None:
    with pytest.raises(ConfigError):
        make_settings(pin_pepper_raw="").validate_startup()


def test_a_missing_hmac_secret_refuses_to_start_when_auth_is_required() -> None:
    with pytest.raises(ConfigError):
        make_settings(hmac_secret_raw="", auth_required=True).validate_startup()


def test_disabling_auth_is_allowed_but_warns_loudly() -> None:
    warnings = make_settings(hmac_secret_raw="", auth_required=False).validate_startup()
    assert any("HMAC" in w for w in warnings)


def test_a_short_key_is_rejected() -> None:
    short = base64.b64encode(b"\x01" * 16).decode()
    with pytest.raises(ConfigError):
        assert make_settings(fle_keys_raw=json.dumps({"k1": short})).fle_keys


def test_a_non_base64_key_is_rejected() -> None:
    with pytest.raises(ConfigError):
        assert make_settings(fle_keys_raw=json.dumps({"k1": "not base64!!"})).fle_keys


def test_malformed_key_json_is_rejected() -> None:
    with pytest.raises(ConfigError):
        assert make_settings(fle_keys_raw="{not json").fle_keys


def test_an_active_key_absent_from_the_map_is_rejected() -> None:
    """Otherwise every enrolment would fail at the first seal, in production."""
    with pytest.raises(ConfigError):
        assert make_settings(
            fle_keys_raw=json.dumps({"k1": TEST_FLE_KEY}), fle_active_key="k9"
        ).fle_keys


def test_inverted_bands_are_rejected_at_construction() -> None:
    """A flag threshold above the approve threshold makes the flagged band empty.

    pydantic wraps a validator's exception in a ValidationError, so the raised
    type is not the ConfigError the validator constructs -- catching the
    specific pair is what documents that, rather than catching Exception and
    hiding whichever one it actually is.
    """
    with pytest.raises((ConfigError, ValidationError)):
        make_settings(approve_threshold=50.0, flag_threshold=80.0)


def test_a_missing_calibration_file_refuses_to_start(tmp_path) -> None:
    with pytest.raises(ConfigError):
        make_settings(calibration_path=tmp_path / "absent.json").validate_startup()


def test_a_high_bcrypt_cost_warns_about_the_latency_budget() -> None:
    warnings = make_settings(bcrypt_cost=13).validate_startup()
    assert any("BCRYPT_COST" in w for w in warnings)


def test_stub_models_warn_loudly() -> None:
    warnings = make_settings(allow_stub_models=True).validate_startup()
    assert any("STUB" in w.upper() for w in warnings)


def test_environment_aliases_are_honoured(monkeypatch) -> None:
    """Deployment platforms use the bare names from the blueprint."""
    monkeypatch.setenv("PNSM_FLE_KEYS", json.dumps({"k1": TEST_FLE_KEY}))
    monkeypatch.setenv("PIN_PEPPER", TEST_PEPPER)
    monkeypatch.setenv("HMAC_SECRET", TEST_HMAC)
    monkeypatch.setenv("APPROVE_THRESHOLD", "77.5")
    monkeypatch.setenv("CALIBRATION_PATH", str(CALIBRATION_PATH))
    settings = Settings()
    assert settings.approve_threshold == 77.5
    assert settings.pin_pepper == base64.b64decode(TEST_PEPPER)
    assert settings.hmac_secret == base64.b64decode(TEST_HMAC)


def test_every_setting_can_be_supplied_with_a_pnsm_prefix(monkeypatch) -> None:
    """The bug this catches is silent: a field with no alias reads only the bare
    name, so `PNSM_MIN_BLUR_VAR=10.0` sets nothing and the production default
    quietly stays in force -- which looks exactly like a setting that worked.

    Rather than listing the fields, this walks every one of them, so a field
    added later without an alias fails here instead of in a deployment.
    """
    missing = [
        name
        for name, field in Settings.model_fields.items()
        if field.validation_alias is None
    ]
    assert not missing, f"these settings cannot be set with a PNSM_ prefix: {missing}"


def test_the_quality_gate_actually_reads_its_environment(monkeypatch) -> None:
    """The specific case CI depends on: the synthetic test frames are sharper
    than a real photograph, so the suite lowers the blur floor. If that variable
    is ignored the gate silently runs at production strictness."""
    monkeypatch.setenv("PNSM_FLE_KEYS", json.dumps({"k1": TEST_FLE_KEY}))
    monkeypatch.setenv("PNSM_PIN_PEPPER", TEST_PEPPER)
    monkeypatch.setenv("PNSM_HMAC_SECRET", TEST_HMAC)
    monkeypatch.setenv("PNSM_CALIBRATION_PATH", str(CALIBRATION_PATH))
    monkeypatch.setenv("PNSM_MIN_BLUR_VAR", "10.0")
    monkeypatch.setenv("PNSM_ENROL_MIN_BLUR_VAR", "11.0")
    monkeypatch.setenv("PNSM_MIN_DET_SCORE", "0.5")

    settings = Settings()
    assert settings.min_blur_var == 10.0
    assert settings.enrol_min_blur_var == 11.0
    assert settings.min_det_score == 0.5
