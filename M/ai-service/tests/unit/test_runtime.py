"""The composition root.

``Runtime`` is where every part of the service is assembled, and a mistake here
is a mistake in production even though every individual component is correct.
It needs no HTTP server, so it can be built and exercised directly -- including
a full enrol-then-verify round trip through the very objects the routers hold.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from app.ai.calibration import CalibrationError
from app.ai.preprocess import DEFAULT_PREPROCESS
from app.config import ConfigError
from app.errors import PnsmError, ReasonCode
from app.runtime import Runtime
from app.security.guards import DeviceContext
from app.services.image_source import ImageRef
from tests.helpers import CALIBRATION_PATH, ULID_A, ULID_B, make_settings, synthetic_jpeg, utcnow


def build_runtime(**overrides) -> Runtime:
    return Runtime(make_settings(**overrides))


# ------------------------------------------------------------------- wiring
def test_a_runtime_builds_with_every_service_wired() -> None:
    runtime = build_runtime()
    for attribute in ("enroll_service", "verify_service", "pin_service", "presign_service"):
        assert getattr(runtime, attribute) is not None, attribute
    assert runtime.engine is not None
    assert runtime.store is not None
    assert runtime.guards is not None
    assert runtime.lockout is not None


def test_health_is_cheap_and_has_the_documented_shape() -> None:
    """A cron pings this every few minutes; it must not touch the model."""
    body = build_runtime().health()
    assert set(body) == {"status", "version", "uptime_s"}
    assert body["status"] == "ok"
    assert body["uptime_s"] >= 0


def test_ready_reports_model_calibration_and_warmth() -> None:
    runtime = build_runtime()
    before = runtime.ready()
    assert before["warm"] is False
    assert before["status"] == "starting"

    runtime.warmup()
    after = runtime.ready()
    assert after["warm"] is True
    assert after["status"] == "ready"
    assert after["model_version"]
    assert after["calibration_version"]
    assert after["preprocess_fingerprint"] == DEFAULT_PREPROCESS.fingerprint()


def test_ready_exposes_the_cosine_behind_the_approve_band() -> None:
    """So an operator can answer 'what does 85% actually mean today?'"""
    thresholds = build_runtime().ready()["thresholds"]
    assert 0.30 < thresholds["approve_at_cosine"] < 0.80
    assert thresholds["approve_at_cosine"] > thresholds["flag_at_cosine"]


def test_warmup_runs_an_inference_without_shipping_anyones_face() -> None:
    """A synthetic tensor, not a bundled photograph of a real person."""
    info = build_runtime(warmup_on_start=True).warmup()
    assert info["warm"] is True
    assert info["dim"] == 512
    assert info["warmup_ms"] >= 0


def test_warmup_can_be_skipped() -> None:
    runtime = build_runtime(warmup_on_start=False)
    assert runtime.warmup() == {"warm": True, "skipped": True}


def test_stub_models_surface_as_a_startup_warning() -> None:
    """Results are meaningless for real faces, so this must be loud."""
    assert any("STUB" in w.upper() for w in build_runtime().warnings)


# -------------------------------------------------------------- calibration
def test_calibration_is_readable_and_reloadable() -> None:
    runtime = build_runtime()
    original = runtime.calibration().calibration_version
    result = runtime.reload_calibration()
    assert result["reloaded"] is True
    assert result["previous"] == original
    assert result["current"]["calibration_version"] == original


def test_environment_overrides_reach_the_loaded_calibration() -> None:
    """The lever that lets a threshold be nudged live during a demo."""
    runtime = build_runtime(approve_threshold=70.0, flag_threshold=40.0)
    calibration = runtime.calibration()
    assert calibration.approve == 70.0
    assert calibration.flag == 40.0


def test_a_calibration_fitted_on_another_pipeline_is_refused(tmp_path: Path) -> None:
    """The structural guard against silent preprocessing drift."""
    payload = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
    payload["measured"]["preprocess_fingerprint"] = "0000deadbeef0000"
    target = tmp_path / "calibration.json"
    target.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(CalibrationError) as caught:
        build_runtime(calibration_path=target)
    assert "fingerprint" in str(caught.value).lower()
    assert "refit" in str(caught.value).lower() or "re-fit" in str(caught.value).lower()


def test_a_missing_calibration_refuses_to_start(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        build_runtime(calibration_path=tmp_path / "absent.json")


def test_a_missing_encryption_key_refuses_to_start() -> None:
    with pytest.raises(ConfigError):
        build_runtime(fle_keys_raw="")


# ------------------------------------------------------- end to end wiring
def test_enrol_then_check_in_through_the_runtimes_own_services() -> None:
    """The whole story, through the exact objects the routers hold."""
    runtime = build_runtime()
    runtime.warmup()

    image = {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(11)).decode()}

    enrolled = runtime.enroll_service.execute(
        user_ref="alice", image=ImageRef(**image), request_id=ULID_A
    )
    assert enrolled["ok"] is True
    assert enrolled["envelope"]["alg"] == "AES-256-GCM"

    result = runtime.verify_service.execute(
        user_ref="alice",
        image=ImageRef(**image),
        envelope=enrolled["envelope"],
        request_id=ULID_B,
        captured_at=utcnow(),
        device=DeviceContext(platform="android"),
    )
    assert result["decision"] == "approved"
    assert result["reason_code"] == "OK_MATCH"
    assert result["latency_ms"]["total"] > 0


def test_the_guards_the_runtime_built_are_actually_enforced() -> None:
    runtime = build_runtime()
    image = {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(12)).decode()}
    enrolled = runtime.enroll_service.execute(
        user_ref="alice", image=ImageRef(**image), request_id=ULID_A
    )

    with pytest.raises(PnsmError) as caught:
        runtime.verify_service.execute(
            user_ref="alice",
            image=ImageRef(**image),
            envelope=enrolled["envelope"],
            request_id=ULID_B,
            captured_at=utcnow(),
            device=DeviceContext(platform="android", is_mock_location=True),
        )
    assert caught.value.code is ReasonCode.MOCK_LOCATION


def test_the_pin_service_the_runtime_built_enforces_lockout() -> None:
    runtime = build_runtime(pin_max_attempts=2)
    record = runtime.pin_service.hash_pin(user_ref="alice", pin="418362")

    assert runtime.pin_service.verify_pin(
        user_ref="alice", pin="418362", pin_hash=record["pin_hash"]
    )["match"] is True

    for _ in range(2):
        runtime.pin_service.verify_pin(user_ref="alice", pin="999111", pin_hash=record["pin_hash"])

    with pytest.raises(PnsmError) as caught:
        runtime.pin_service.verify_pin(user_ref="alice", pin="418362", pin_hash=record["pin_hash"])
    assert caught.value.code is ReasonCode.RATE_LIMITED


def test_two_runtimes_do_not_share_guard_state() -> None:
    """Each test, and each process, starts clean."""
    first, second = build_runtime(), build_runtime()
    first.guards.check_request_id(ULID_A)
    second.guards.check_request_id(ULID_A)  # must not raise
