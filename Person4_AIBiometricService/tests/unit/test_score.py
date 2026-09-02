"""Similarity scoring and the calibrated three-band decision.

The first test in this file is the whole argument of blueprint correction 1: it
asserts that the service does *not* use ``cosine * 100``.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.ai.calibration import load_calibration
from app.ai.score import BANDS_THREE, BANDS_TWO, cosine_similarity, decide, l2_normalise
from app.errors import Decision, ReasonCode
from tests.helpers import CALIBRATION_PATH, blended_vector, unit_vector


def _calibration():
    return load_calibration(CALIBRATION_PATH)


def test_confidence_is_calibrated_not_cosine_times_one_hundred() -> None:
    """A realistic genuine pair sits far below 0.85 cosine yet must approve.

    DeepFace's calibrated default for ArcFace is a cosine *distance* of 0.68 --
    a similarity of 0.32. Under the naive rule a genuine pair at cosine 0.62
    would score 62 and be rejected; under the fitted map it approves.
    """
    calibration = _calibration()
    naive = 0.62 * 100
    calibrated = calibration.confidence(0.62)
    assert naive < calibration.approve, "sanity: the naive rule would reject this pair"
    assert calibrated >= calibration.approve, "the calibrated map must approve it"


def test_impostor_pairs_score_near_zero() -> None:
    calibration = _calibration()
    assert calibration.confidence(0.05) < 5.0
    assert calibration.confidence(0.20) < 20.0


def test_identical_vectors_approve() -> None:
    calibration = _calibration()
    vector = unit_vector(1)
    result = decide(vector, vector, calibration)
    assert result.decision is Decision.APPROVED
    assert result.reason_code is ReasonCode.OK_MATCH
    assert result.raw_cosine == pytest.approx(1.0, abs=1e-4)


def test_independent_vectors_reject() -> None:
    calibration = _calibration()
    result = decide(unit_vector(1), unit_vector(2), calibration)
    assert result.decision is Decision.REJECTED
    assert result.reason_code is ReasonCode.NO_MATCH


def test_borderline_pairs_land_in_the_flagged_band() -> None:
    """FR-07's 'otherwise it is flagged for HR review' must be reachable."""
    calibration = _calibration()
    base, other = unit_vector(1), unit_vector(2)
    flagged = [
        decide(base, blended_vector(base, other, alpha), calibration, bands=BANDS_THREE).decision
        for alpha in (0.42, 0.44, 0.46, 0.48)
    ]
    assert Decision.FLAGGED in flagged


def test_the_default_band_model_is_the_master_plans_two_band_rule() -> None:
    """Quadrant IV: approve at or above the threshold, otherwise reject.

    The default must be the master plan's rule, not FR-07's, because a service
    that silently flags where the plan says reject would let a borderline
    stranger through the door.
    """
    calibration = _calibration()
    base, other = unit_vector(1), unit_vector(2)
    decisions = {
        decide(base, blended_vector(base, other, alpha), calibration).decision
        for alpha in (0.42, 0.44, 0.46, 0.48)
    }
    assert Decision.FLAGGED not in decisions
    assert decisions <= {Decision.APPROVED, Decision.REJECTED}


def test_both_band_models_approve_at_exactly_the_same_score() -> None:
    """The band choice is a policy on what happens *below* the threshold."""
    calibration = _calibration()
    base, other = unit_vector(1), unit_vector(2)
    for alpha in (0.30, 0.42, 0.46, 0.60, 0.90, 1.0):
        live = blended_vector(base, other, alpha)
        two = decide(base, live, calibration, bands=BANDS_TWO)
        three = decide(base, live, calibration, bands=BANDS_THREE)
        assert two.confidence == three.confidence
        assert (two.decision is Decision.APPROVED) == (three.decision is Decision.APPROVED)


def test_anything_short_of_approval_raises_an_hr_alert() -> None:
    """Person 3 pushes the WebSocket alert off this flag, under either model."""
    calibration = _calibration()
    base, other = unit_vector(1), unit_vector(2)

    assert decide(base, base, calibration).hr_alert is False
    assert decide(base, other, calibration).hr_alert is True

    borderline = [
        decide(base, blended_vector(base, other, alpha), calibration, bands=BANDS_THREE)
        for alpha in (0.42, 0.44, 0.46, 0.48)
    ]
    flagged = [r for r in borderline if r.decision is Decision.FLAGGED]
    assert flagged, "sanity: the flagged band must be reachable"
    assert all(r.hr_alert for r in flagged), "a flagged check-in still needs a human"


def test_the_flag_threshold_is_published_only_where_it_applies() -> None:
    """Publishing a flag threshold the service never uses would mislead HR."""
    calibration = _calibration()
    vector = unit_vector(1)

    two = decide(vector, vector, calibration).thresholds()
    three = decide(vector, vector, calibration, bands=BANDS_THREE).thresholds()

    assert two["bands"] == BANDS_TWO
    assert "flag" not in two and "flag_at_cosine" not in two
    assert three["bands"] == BANDS_THREE
    assert three["flag"] == calibration.flag
    assert three["approve"] == two["approve"], "the approve threshold never moves"


def test_an_unknown_band_model_is_rejected_rather_than_guessed() -> None:
    calibration = _calibration()
    vector = unit_vector(1)
    with pytest.raises(ValueError):
        decide(vector, vector, calibration, bands="four")


def test_bands_are_ordered_across_the_whole_cosine_range() -> None:
    calibration = _calibration()
    previous = -1.0
    for cosine in np.linspace(-1.0, 1.0, 201):
        confidence = calibration.confidence(float(cosine))
        assert confidence >= previous - 1e-9, "confidence must be monotonic in cosine"
        previous = confidence
    assert 0.0 <= calibration.confidence(-1.0) <= 100.0
    assert 0.0 <= calibration.confidence(1.0) <= 100.0


def test_confidence_inverse_is_consistent() -> None:
    calibration = _calibration()
    for target in (60.0, 75.0, 85.0, 95.0):
        cosine = calibration.cosine_for_confidence(target)
        assert calibration.confidence(cosine) == pytest.approx(target, abs=1e-6)


def test_approve_threshold_maps_to_a_realistic_cosine() -> None:
    """85% confidence must correspond to a cosine ArcFace can actually reach."""
    calibration = _calibration()
    cosine_at_approve = calibration.cosine_for_confidence(calibration.approve)
    assert 0.30 < cosine_at_approve < 0.80, (
        f"approve maps to cosine {cosine_at_approve:.3f}, which is outside the range "
        "genuine ArcFace pairs occupy"
    )


def test_confidence_saturates_without_overflow() -> None:
    calibration = _calibration()
    assert calibration.confidence(float("nan")) == 0.0
    assert 0.0 <= calibration.confidence(-1e6) <= 100.0
    assert 0.0 <= calibration.confidence(1e6) <= 100.0


def test_cosine_is_symmetric_and_bounded() -> None:
    a, b = unit_vector(3), unit_vector(4)
    assert cosine_similarity(a, b) == pytest.approx(cosine_similarity(b, a))
    assert -1.0 <= cosine_similarity(a, b) <= 1.0


def test_unnormalised_input_is_normalised_before_comparison() -> None:
    """A stored vector written by an older build must still score correctly."""
    vector = unit_vector(5)
    assert cosine_similarity(vector, vector * 7.5) == pytest.approx(1.0, abs=1e-5)


def test_degenerate_vectors_raise() -> None:
    with pytest.raises(ValueError):
        l2_normalise(np.zeros(512, dtype=np.float32))
    with pytest.raises(ValueError):
        l2_normalise(np.ones(10, dtype=np.float32))
