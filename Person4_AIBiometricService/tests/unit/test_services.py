"""Enrolment and verification as use cases, without an HTTP server.

These are the real end-to-end tests of the module's behaviour. Everything the
routers do is a thin adaptation of what is exercised here, which is why the
suite still means something on a machine where FastAPI is not installed.
"""

from __future__ import annotations

import datetime as _dt

import numpy as np
import pytest

from app.ai.calibration import load_calibration
from app.crypto import fle
from app.errors import PnsmError, ReasonCode
from app.security.guards import DeviceContext, SecurityGuards
from app.services.enroll import EnrollService
from app.services.image_source import ImageRef, resolve
from app.services.presign import PresignService
from app.services.verify import VerifyService
from app.storage.s3 import InMemoryObjectStore
from tests.helpers import (
    CALIBRATION_PATH,
    ULID_A,
    ULID_B,
    ULID_C,
    make_engine,
    make_key_provider,
    make_settings,
    synthetic_jpeg,
    utcnow,
)


class Fixture:
    """A whole service graph wired against in-memory doubles."""

    def __init__(self, **setting_overrides) -> None:
        self.settings = make_settings(**setting_overrides)
        self.engine = make_engine(self.settings)
        self.keys = make_key_provider(self.settings)
        self.store = InMemoryObjectStore()
        self.guards = SecurityGuards(
            max_clock_skew_s=self.settings.max_clock_skew_s,
            nonce_ttl_s=self.settings.nonce_ttl_s,
            image_replay_window=self.settings.image_replay_window,
            rate_limit_per_min=self.settings.verify_rate_limit_per_min,
        )
        self.calibration = load_calibration(CALIBRATION_PATH)
        self.enroll = EnrollService(self.engine, self.store, self.settings, self.keys)
        self.verify = VerifyService(
            self.engine,
            self.store,
            self.guards,
            self.settings,
            lambda: self.calibration,
            self.keys,
        )
        self.presign = PresignService(self.store, self.settings)

    def put(self, key: str, seed: int = 0) -> tuple[str, bytes]:
        payload = synthetic_jpeg(seed)
        self.store.put(key, payload)
        return key, payload

    def enrol(self, user_ref: str = "alice", seed: int = 0) -> dict:
        key, _ = self.put(f"refs/{user_ref}/{ULID_A}.jpg", seed)
        return self.enroll.execute(
            user_ref=user_ref, image=ImageRef("s3_key", key), request_id=ULID_A
        )

    def check_in(
        self,
        envelope: dict,
        *,
        user_ref: str = "alice",
        seed: int = 0,
        request_id: str = ULID_B,
        key_suffix: str = "b",
        device: DeviceContext | None = None,
        captured_at: _dt.datetime | None = None,
    ) -> dict:
        key = f"checkins/2026/08/26/{user_ref}/{ULID_B if key_suffix == 'b' else ULID_C}.jpg"
        self.put(key, seed)
        return self.verify.execute(
            user_ref=user_ref,
            image=ImageRef("s3_key", key),
            envelope=envelope,
            request_id=request_id,
            captured_at=captured_at or utcnow(),
            device=device or DeviceContext(platform="android"),
        )


# ------------------------------------------------------------------ enrol
def test_enrolment_returns_an_encrypted_envelope_not_a_vector() -> None:
    """Person 3 must never receive plaintext biometric data."""
    fixture = Fixture()
    result = fixture.enrol()
    assert result["ok"] is True
    envelope = result["envelope"]
    assert envelope["alg"] == "AES-256-GCM"
    serialised = str(result)
    assert "vector" not in serialised
    assert "embedding" not in serialised


def test_the_envelope_decrypts_only_with_the_key() -> None:
    fixture = Fixture()
    envelope = fixture.enrol()["envelope"]
    vector = fle.open_envelope(envelope, user_ref="alice", provider=fixture.keys)
    assert vector.shape == (512,)
    assert float(np.linalg.norm(vector)) == pytest.approx(1.0, abs=1e-5)


def test_enrolment_reports_quality_so_a_bad_photo_can_be_retaken() -> None:
    result = Fixture().enrol()
    assert set(result["quality"]) >= {"det_score", "blur_var", "face_area_ratio", "brightness"}
    assert isinstance(result["warnings"], list)


def test_enrolment_rejects_a_frame_with_two_faces() -> None:
    fixture = Fixture()
    fixture.engine = make_engine(fixture.settings, faces=2)
    fixture.enroll = EnrollService(fixture.engine, fixture.store, fixture.settings, fixture.keys)
    with pytest.raises(PnsmError) as caught:
        fixture.enrol()
    assert caught.value.code is ReasonCode.MULTIPLE_FACES


# ----------------------------------------------------------------- verify
def test_the_same_face_approves() -> None:
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]
    result = fixture.check_in(envelope, seed=5)
    assert result["decision"] == "approved"
    assert result["reason_code"] == "OK_MATCH"
    assert result["confidence"] >= fixture.calibration.approve


def test_a_different_face_is_rejected() -> None:
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]
    result = fixture.check_in(envelope, seed=99)
    assert result["decision"] == "rejected"
    assert result["reason_code"] == "NO_MATCH"


def test_the_response_carries_the_full_documented_contract() -> None:
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]
    result = fixture.check_in(envelope, seed=5)
    assert set(result) >= {
        "decision",
        "confidence",
        "raw_cosine",
        "threshold",
        "reason_code",
        "hr_alert",
        "quality",
        "model_version",
        "image_hash",
        "capture_skew_s",
        "latency_ms",
    }
    assert 0.0 <= result["confidence"] <= 100.0
    assert -1.0 <= result["raw_cosine"] <= 1.0
    assert result["latency_ms"]["total"] > 0


def test_enrolment_tells_person_3_where_the_envelope_belongs() -> None:
    """The master plan requires embeddings out of the Users document.

    Carried in the response body rather than left as a line in an integration
    guide, because the path of least resistance under a deadline is
    ``db.users.updateOne({}, {$set: {embedding: env}})`` -- which is exactly the
    anti-pattern the plan calls out. See D-13.
    """
    result = Fixture().enrol()
    assert result["storage_target"] == {
        "collection": "FaceEmbeddings",
        "link_field": "user_id",
    }


def test_an_approval_raises_no_alert_and_anything_else_does() -> None:
    """Person 3's WebSocket push reads this field, not the decision string."""
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]

    approved = fixture.check_in(envelope, seed=5)
    assert approved["decision"] == "approved"
    assert approved["hr_alert"] is False

    rejected = fixture.check_in(envelope, seed=99, request_id=ULID_C)
    assert rejected["decision"] == "rejected"
    assert rejected["hr_alert"] is True, (
        "the master plan routes an instant alert to HR on anything below the threshold"
    )


def test_the_published_thresholds_match_the_band_policy_in_force() -> None:
    """Advertising a flag threshold the service never applies would mislead HR."""
    two = Fixture(decision_bands="two")
    result = two.check_in(two.enrol(seed=5)["envelope"], seed=5)
    assert result["threshold"]["bands"] == "two"
    assert "flag" not in result["threshold"]

    three = Fixture(decision_bands="three")
    result = three.check_in(three.enrol(seed=5)["envelope"], seed=5)
    assert result["threshold"]["bands"] == "three"
    assert result["threshold"]["flag"] == three.calibration.flag
    assert result["threshold"]["approve"] == three.calibration.approve


def test_raw_cosine_and_confidence_are_different_numbers() -> None:
    """Correction 1, asserted end to end: confidence is not cosine * 100.

    A non-matching pair is used because an identical pair sits at cosine 1.0,
    where the calibrated map and the naive rule happen to agree at 100.
    """
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]
    result = fixture.check_in(envelope, seed=99)
    assert abs(result["confidence"] - result["raw_cosine"] * 100) > 1.0


# ------------------------------------------------------- guards in the path
def test_a_mock_location_is_refused_before_any_inference() -> None:
    fixture = Fixture()
    envelope = fixture.enrol()["envelope"]
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope, device=DeviceContext(is_mock_location=True))
    assert caught.value.code is ReasonCode.MOCK_LOCATION


def test_a_stale_capture_is_refused() -> None:
    fixture = Fixture()
    envelope = fixture.enrol()["envelope"]
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope, captured_at=utcnow() - _dt.timedelta(hours=3))
    assert caught.value.code is ReasonCode.STALE_CAPTURE


def test_a_replayed_request_id_is_refused() -> None:
    fixture = Fixture()
    envelope = fixture.enrol()["envelope"]
    fixture.check_in(envelope, request_id=ULID_B, seed=5)
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope, request_id=ULID_B, seed=6, key_suffix="c")
    assert caught.value.code is ReasonCode.REPLAY_DETECTED


def test_a_reused_selfie_is_refused_even_with_a_fresh_request_id() -> None:
    """The attack GPS, PIN and face match all pass cleanly."""
    fixture = Fixture()
    envelope = fixture.enrol(seed=5)["envelope"]
    fixture.check_in(envelope, request_id=ULID_B, seed=5)
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope, request_id=ULID_C, seed=5, key_suffix="c")
    assert caught.value.code is ReasonCode.REPLAY_DETECTED


def test_a_missing_envelope_is_a_workflow_error() -> None:
    fixture = Fixture()
    with pytest.raises(PnsmError) as caught:
        fixture.check_in({})
    assert caught.value.code is ReasonCode.NO_REFERENCE_EMBEDDING


def test_another_employees_envelope_fails_closed() -> None:
    """The AAD binding, proven through the whole use case."""
    fixture = Fixture()
    alice = fixture.enrol(user_ref="alice", seed=5)["envelope"]
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(alice, user_ref="bob", seed=5)
    assert caught.value.code is ReasonCode.DECRYPT_FAILED


def test_a_stale_model_version_asks_for_re_enrolment() -> None:
    fixture = Fixture()
    envelope = fle.seal(
        np.ones(512, dtype=np.float32) / np.sqrt(512),
        user_ref="alice",
        model_version="ancient_model",
        provider=fixture.keys,
    )
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope)
    assert caught.value.code is ReasonCode.MODEL_VERSION_MISMATCH


def test_the_rate_limit_applies_to_verification() -> None:
    fixture = Fixture(verify_rate_limit_per_min=1)
    envelope = fixture.enrol(seed=5)["envelope"]
    fixture.check_in(envelope, request_id=ULID_B, seed=5)
    with pytest.raises(PnsmError) as caught:
        fixture.check_in(envelope, request_id=ULID_C, seed=6, key_suffix="c")
    assert caught.value.code is ReasonCode.RATE_LIMITED


# ---------------------------------------------------------------- storage
def test_presigned_uploads_build_the_key_server_side() -> None:
    fixture = Fixture()
    signed = fixture.presign.presign_put(
        user_ref="alice",
        purpose="checkin",
        object_id=ULID_A,
        content_type="image/webp",
        content_length=150_000,
    )
    assert signed["object_key"].startswith("checkins/")
    assert signed["object_key"].endswith(f"{ULID_A}.webp")
    assert signed["headers"]["Content-Length"] == "150000"


def test_an_oversized_upload_is_refused_at_signing_time() -> None:
    fixture = Fixture()
    with pytest.raises(PnsmError) as caught:
        fixture.presign.presign_put(
            user_ref="alice",
            purpose="checkin",
            object_id=ULID_A,
            content_type="image/webp",
            content_length=5_000_000,
        )
    assert caught.value.code is ReasonCode.PAYLOAD_TOO_LARGE


def test_presigned_reads_refuse_a_key_outside_a_managed_prefix() -> None:
    fixture = Fixture()
    with pytest.raises(PnsmError):
        fixture.presign.presign_get(object_key="../../etc/passwd")


def test_inline_base64_images_are_size_bounded() -> None:
    settings = make_settings(max_upload_bytes=1024)
    store = InMemoryObjectStore()
    oversized = ImageRef("base64", "A" * 20_000)
    with pytest.raises(PnsmError) as caught:
        resolve(oversized, store, max_bytes=settings.max_upload_bytes)
    assert caught.value.code is ReasonCode.PAYLOAD_TOO_LARGE


def test_a_malformed_image_reference_is_a_bad_request() -> None:
    with pytest.raises(PnsmError):
        ImageRef.parse({"kind": "ftp", "value": "x"})
    with pytest.raises(PnsmError):
        ImageRef.parse({"kind": "r2_key"})
    with pytest.raises(PnsmError):
        ImageRef.parse("not-an-object")
