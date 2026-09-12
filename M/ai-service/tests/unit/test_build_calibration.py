"""The calibration fitting maths.

The dataset half of ``build_calibration.py`` needs real photographs and real
model weights.  The maths half does not, and the maths half is where a mistake
would silently produce a plausible-looking but wrong threshold -- so it is
tested here against synthetic distributions with known answers.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from calibration.build_calibration import (  # noqa: E402
    auc_score,
    build_pairs,
    confidence,
    midpoint_at_far,
    roc,
    slope_anchored,
    slope_mle,
)


def synthetic_scores(seed: int = 0, n: int = 4000):
    """Distributions shaped like real ArcFace output.

    Genuine pairs centre near 0.55, impostors near 0.05 -- which is the whole
    reason a raw 0.85 threshold cannot work.
    """
    rng = np.random.default_rng(seed)
    genuine = np.clip(rng.normal(0.55, 0.11, n), -1, 1)
    impostor = np.clip(rng.normal(0.05, 0.07, n * 4), -1, 1)
    return genuine, impostor


# ------------------------------------------------------------------- pairs
def test_pairs_are_built_within_and_across_identities() -> None:
    vectors = {
        "a": [np.array([1.0, 0.0]), np.array([0.9, 0.1]), np.array([0.8, 0.2])],
        "b": [np.array([0.0, 1.0]), np.array([0.1, 0.9])],
    }
    genuine, impostor = build_pairs(vectors)
    assert len(genuine) == 3 + 1  # C(3,2) within a, C(2,2) within b
    assert len(impostor) == 3 * 2  # every a against every b


def test_genuine_pairs_outscore_impostor_pairs_on_clean_data() -> None:
    vectors = {
        "a": [np.array([1.0, 0.0]), np.array([0.99, 0.14])],
        "b": [np.array([0.0, 1.0]), np.array([0.14, 0.99])],
    }
    genuine, impostor = build_pairs(vectors)
    assert genuine.min() > impostor.max()


# --------------------------------------------------------------------- roc
def test_roc_endpoints_are_degenerate_as_they_must_be() -> None:
    genuine, impostor = synthetic_scores()
    curve = roc(genuine, impostor, steps=201)
    assert curve["tar"][0] == pytest.approx(1.0)
    assert curve["far"][0] == pytest.approx(1.0)
    assert curve["tar"][-1] == pytest.approx(0.0)
    assert curve["far"][-1] == pytest.approx(0.0)


def test_error_rates_fall_monotonically_with_the_threshold() -> None:
    genuine, impostor = synthetic_scores()
    curve = roc(genuine, impostor, steps=401)
    assert np.all(np.diff(curve["tar"]) <= 1e-12)
    assert np.all(np.diff(curve["far"]) <= 1e-12)


def test_auc_is_high_for_separable_distributions() -> None:
    genuine, impostor = synthetic_scores()
    assert auc_score(genuine, impostor) > 0.99


def test_auc_is_one_half_when_the_distributions_are_identical() -> None:
    rng = np.random.default_rng(3)
    same = rng.normal(0.3, 0.1, 3000)
    other = rng.normal(0.3, 0.1, 3000)
    assert auc_score(same, other) == pytest.approx(0.5, abs=0.03)


def test_auc_handles_ties_without_bias() -> None:
    tied = np.zeros(500)
    assert auc_score(tied, tied.copy()) == pytest.approx(0.5, abs=1e-9)


# ------------------------------------------------------------------- fit
def test_the_midpoint_delivers_the_requested_false_accept_rate() -> None:
    _, impostor = synthetic_scores()
    for target in (0.05, 0.01, 0.001):
        midpoint = midpoint_at_far(impostor, target)
        measured = float((impostor >= midpoint).mean())
        assert measured == pytest.approx(target, abs=0.005)


def test_a_stricter_target_pushes_the_midpoint_higher() -> None:
    _, impostor = synthetic_scores()
    assert midpoint_at_far(impostor, 0.001) > midpoint_at_far(impostor, 0.05)


def test_the_anchored_slope_delivers_the_requested_coverage() -> None:
    genuine, impostor = synthetic_scores()
    midpoint = midpoint_at_far(impostor, 0.01)
    slope = slope_anchored(genuine, midpoint, approve=85.0, coverage=0.95)
    assert math.isfinite(slope) and slope > 0

    scores = confidence(genuine, slope, midpoint)
    assert float((np.asarray(scores) >= 85.0).mean()) == pytest.approx(0.95, abs=0.02)


def test_the_anchored_slope_reports_impossibility_rather_than_guessing() -> None:
    """Overlapping distributions must produce NaN, not a plausible wrong number."""
    rng = np.random.default_rng(9)
    overlapping = rng.normal(0.10, 0.05, 2000)
    impostor = rng.normal(0.10, 0.05, 2000)
    midpoint = midpoint_at_far(impostor, 0.001)
    assert math.isnan(slope_anchored(overlapping, midpoint, approve=85.0, coverage=0.95))


def test_maximum_likelihood_recovers_a_known_slope() -> None:
    """Generate labels from a logistic with a known 'a' and recover it."""
    rng = np.random.default_rng(11)
    true_a, true_b = 14.0, 0.40
    cosines = rng.uniform(-0.1, 0.9, 40_000)
    probabilities = 1.0 / (1.0 + np.exp(-true_a * (cosines - true_b)))
    labels = rng.random(len(cosines)) < probabilities

    recovered = slope_mle(cosines[labels], cosines[~labels], true_b)
    assert recovered == pytest.approx(true_a, rel=0.10)


def test_maximum_likelihood_stays_positive_and_finite() -> None:
    genuine, impostor = synthetic_scores(seed=5)
    slope = slope_mle(genuine, impostor, midpoint_at_far(impostor, 0.01))
    assert math.isfinite(slope) and slope > 0


# ------------------------------------------------------------- confidence
def test_confidence_is_bounded_and_monotonic() -> None:
    grid = np.linspace(-1.0, 1.0, 500)
    values = np.asarray(confidence(grid, 18.0, 0.42))
    assert values.min() >= 0.0 and values.max() <= 100.0
    assert np.all(np.diff(values) >= -1e-12)


def test_confidence_is_exactly_fifty_at_the_midpoint() -> None:
    assert confidence(0.42, 18.0, 0.42) == pytest.approx(50.0)


def test_confidence_does_not_overflow_at_extremes() -> None:
    assert 0.0 <= float(confidence(-1e6, 18.0, 0.42)) <= 100.0
    assert 0.0 <= float(confidence(1e6, 18.0, 0.42)) <= 100.0


def test_the_fitted_map_beats_the_naive_rule_on_realistic_data() -> None:
    """The end-to-end argument for blueprint correction 1, in one assertion."""
    genuine, impostor = synthetic_scores()
    midpoint = midpoint_at_far(impostor, 0.01)
    slope = slope_anchored(genuine, midpoint, approve=85.0, coverage=0.95)

    naive_accept = float((genuine * 100 >= 85.0).mean())
    fitted_accept = float((np.asarray(confidence(genuine, slope, midpoint)) >= 85.0).mean())

    assert naive_accept < 0.05, "the naive rule should reject almost every genuine pair"
    assert fitted_accept > 0.90, "the fitted map should accept almost every genuine pair"
