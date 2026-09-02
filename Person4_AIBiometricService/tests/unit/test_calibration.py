"""Calibration loading, validation and the refuse-to-start guarantees."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ai.calibration import CalibrationError, load_calibration
from app.ai.preprocess import DEFAULT_PREPROCESS
from tests.helpers import CALIBRATION_PATH


def _valid_payload(**overrides) -> dict:
    payload = {
        "calibration_version": "test-1",
        "model_version": "stub_v1",
        "logistic": {"a": 18.0, "b": 0.42},
        "bands": {"approve": 85.0, "flag": 60.0},
        "measured": {"preprocess_fingerprint": DEFAULT_PREPROCESS.fingerprint()},
        "fitted_at": "2026-08-26T00:00:00Z",
    }
    payload.update(overrides)
    return payload


def _write(tmp_path: Path, payload: dict) -> Path:
    target = tmp_path / "calibration.json"
    target.write_text(json.dumps(payload), encoding="utf-8")
    return target


def test_the_repository_ships_a_loadable_calibration() -> None:
    calibration = load_calibration(CALIBRATION_PATH)
    assert calibration.a > 0
    assert 0.0 <= calibration.flag < calibration.approve <= 100.0


def test_a_missing_file_refuses_rather_than_defaulting(tmp_path: Path) -> None:
    """An unknown decision threshold is exactly what this module exists to prevent."""
    with pytest.raises(CalibrationError):
        load_calibration(tmp_path / "absent.json")


def test_malformed_json_is_rejected(tmp_path: Path) -> None:
    target = tmp_path / "calibration.json"
    target.write_text("{not json", encoding="utf-8")
    with pytest.raises(CalibrationError):
        load_calibration(target)


def test_a_missing_logistic_block_is_rejected(tmp_path: Path) -> None:
    payload = _valid_payload()
    del payload["logistic"]
    with pytest.raises(CalibrationError):
        load_calibration(_write(tmp_path, payload))


def test_a_non_positive_slope_is_rejected(tmp_path: Path) -> None:
    """A slope of zero or below inverts or flattens the mapping entirely."""
    for slope in (0.0, -3.0):
        with pytest.raises(CalibrationError):
            load_calibration(_write(tmp_path, _valid_payload(logistic={"a": slope, "b": 0.4})))


def test_a_midpoint_outside_the_cosine_range_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(CalibrationError):
        load_calibration(_write(tmp_path, _valid_payload(logistic={"a": 18.0, "b": 4.2})))


def test_inverted_bands_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(CalibrationError):
        load_calibration(_write(tmp_path, _valid_payload(bands={"approve": 40.0, "flag": 80.0})))


def test_a_calibration_for_another_model_is_rejected(tmp_path: Path) -> None:
    """A fit is only valid for the model it was measured on."""
    target = _write(tmp_path, _valid_payload(model_version="some_other_model"))
    with pytest.raises(CalibrationError):
        load_calibration(target, expected_model_version="stub_v1")


def test_environment_overrides_win_over_the_file(tmp_path: Path) -> None:
    """So a threshold can be nudged live during a demo without refitting."""
    target = _write(tmp_path, _valid_payload())
    calibration = load_calibration(target, approve_override=70.0, flag_override=40.0)
    assert calibration.approve == 70.0
    assert calibration.flag == 40.0


def test_summary_reports_the_cosine_behind_each_band(tmp_path: Path) -> None:
    calibration = load_calibration(_write(tmp_path, _valid_payload()))
    summary = calibration.summary()
    assert "approve_at_cosine" in summary
    assert 0.0 < summary["approve_at_cosine"] < 1.0
    assert summary["approve_at_cosine"] > summary["flag_at_cosine"]
