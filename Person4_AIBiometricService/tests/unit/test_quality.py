"""Quality metrics and the enrolment/verification gate."""

from __future__ import annotations

import cv2
import numpy as np

from app.ai.preprocess import CHIP_SIZE
from app.ai.quality import QualityMetrics, blur_variance, gate, mean_brightness, measure, warnings_for
from app.errors import ReasonCode
from tests.helpers import make_settings, synthetic_frame


def _chip(value: int = 128) -> np.ndarray:
    return np.full((CHIP_SIZE, CHIP_SIZE, 3), value, dtype=np.uint8)


def _metrics(**overrides) -> QualityMetrics:
    base = {
        "det_score": 0.95,
        "blur_var": 300.0,
        "face_area_ratio": 0.30,
        "brightness": 130.0,
        "faces_found": 1,
    }
    base.update(overrides)
    return QualityMetrics(**base)


def test_blur_variance_separates_sharp_from_soft() -> None:
    sharp = synthetic_frame(1)
    soft = cv2.GaussianBlur(sharp, (0, 0), 6.0)
    assert blur_variance(sharp) > blur_variance(soft)


def test_a_flat_image_has_almost_no_high_frequency_energy() -> None:
    assert blur_variance(_chip()) < 1.0


def test_mean_brightness_tracks_pixel_value() -> None:
    assert mean_brightness(_chip(0)) < 1.0
    assert mean_brightness(_chip(255)) > 254.0
    assert 100 < mean_brightness(_chip(128)) < 140


def test_measure_computes_area_against_the_full_frame() -> None:
    frame = synthetic_frame()
    metrics = measure(frame, _chip(), det_score=0.9, box=(0, 0, 320, 240), faces_found=1)
    # 320x240 of a 640x480 frame is a quarter of the area.
    assert abs(metrics.face_area_ratio - 0.25) < 1e-6


def test_a_clean_face_passes_both_gates() -> None:
    settings = make_settings()
    assert gate(_metrics(), settings, enrolment=False) is None
    assert gate(_metrics(), settings, enrolment=True) is None


def test_no_face_and_multiple_faces_are_distinguished() -> None:
    settings = make_settings()
    assert gate(_metrics(faces_found=0), settings, enrolment=False) is ReasonCode.NO_FACE_DETECTED
    assert gate(_metrics(faces_found=2), settings, enrolment=False) is ReasonCode.MULTIPLE_FACES


def test_each_failure_maps_to_its_own_actionable_code() -> None:
    settings = make_settings(min_blur_var=80.0, min_face_area_ratio=0.015)
    assert gate(_metrics(det_score=0.1), settings, enrolment=False) is ReasonCode.NO_FACE_DETECTED
    assert gate(_metrics(face_area_ratio=0.001), settings, enrolment=False) is ReasonCode.FACE_TOO_SMALL
    assert gate(_metrics(blur_var=5.0), settings, enrolment=False) is ReasonCode.IMAGE_TOO_BLURRY
    assert gate(_metrics(brightness=10.0), settings, enrolment=False) is ReasonCode.IMAGE_TOO_DARK
    assert gate(_metrics(brightness=250.0), settings, enrolment=False) is ReasonCode.IMAGE_TOO_DARK


def test_enrolment_holds_a_stricter_bar_than_check_in() -> None:
    """A poor reference photo degrades every future check-in for that employee."""
    settings = make_settings(
        min_det_score=0.80,
        enrol_min_det_score=0.90,
        min_blur_var=80.0,
        enrol_min_blur_var=120.0,
        min_face_area_ratio=0.015,
        enrol_min_face_area_ratio=0.04,
    )
    borderline = _metrics(det_score=0.85, blur_var=100.0, face_area_ratio=0.02)
    assert gate(borderline, settings, enrolment=False) is None
    assert gate(borderline, settings, enrolment=True) is not None


def test_gate_checks_framing_before_focus_before_light() -> None:
    """Order is the order a user can act on: move closer, hold still, find light."""
    settings = make_settings(min_blur_var=80.0, min_face_area_ratio=0.015)
    everything_wrong = _metrics(face_area_ratio=0.001, blur_var=1.0, brightness=5.0)
    assert gate(everything_wrong, settings, enrolment=False) is ReasonCode.FACE_TOO_SMALL


def test_warnings_are_advisory_and_never_block() -> None:
    settings = make_settings()
    notes = warnings_for(_metrics(blur_var=20.0, brightness=60.0), settings)
    assert notes and all(isinstance(note, str) for note in notes)
    assert warnings_for(_metrics(blur_var=5000.0, brightness=130.0, face_area_ratio=0.5), settings) == []


def test_metrics_serialise_with_stable_rounding() -> None:
    payload = _metrics(blur_var=123.456789).as_dict()
    assert payload["blur_var"] == 123.46
    assert set(payload) == {"det_score", "blur_var", "face_area_ratio", "brightness", "faces_found"}
