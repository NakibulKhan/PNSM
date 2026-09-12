"""Similarity scoring and the three-band decision.

The whole point of this module is that ``confidence`` is *not* ``cosine * 100``.
ArcFace does not put genuine pairs above 0.85 raw cosine -- DeepFace's own
calibrated default for ArcFace is a cosine distance of 0.68, i.e. a similarity
of 0.32.  Multiplying raw cosine by 100 and demanding 85 would reject nearly
every legitimate employee.

Confidence is therefore a fitted logistic map (see
:mod:`app.ai.calibration`), which keeps FR-07's "85% confidence" wording exactly
true while anchoring the decision on measured error rates.

Reference: blueprint sections 00 (correction 1) and 04.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from app.ai.calibration import Calibration
from app.config import EMBEDDING_DIM
from app.errors import Decision, ReasonCode

#: Below this L2 norm a vector is treated as degenerate rather than normalised.
_MIN_NORM = 1e-8


def l2_normalise(vector: np.ndarray) -> np.ndarray:
    """Scale a vector to unit length so cosine reduces to a dot product."""
    arr = np.asarray(vector, dtype=np.float32).ravel()
    if arr.shape != (EMBEDDING_DIM,):
        raise ValueError(f"expected a ({EMBEDDING_DIM},) vector, got {arr.shape}")
    if not np.all(np.isfinite(arr)):
        raise ValueError("vector contains NaN or infinity")
    norm = float(np.linalg.norm(arr))
    if norm < _MIN_NORM:
        raise ValueError("vector has near-zero norm and cannot be normalised")
    return (arr / norm).astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity in [-1, 1].

    Both inputs are re-normalised rather than assumed unit-length: a stored
    vector may have been written by an older build, and the cost is a few
    microseconds against the risk of a silently wrong score.
    """
    ua = l2_normalise(a)
    ub = l2_normalise(b)
    value = float(np.dot(ua, ub))
    # Clamp away float error at the extremes so downstream maths stays in range.
    return max(-1.0, min(1.0, value))


#: The master plan's model: at or above the threshold approve, otherwise
#: reject and route a WebSocket alert to HR for manual auditing.
BANDS_TWO = "two"
#: FR-07's model: an intermediate band is flagged for review rather than
#: rejected outright. Approves at exactly the same score.
BANDS_THREE = "three"


@dataclass(frozen=True)
class ScoreResult:
    """Outcome of one 1:1 comparison."""

    decision: Decision
    reason_code: ReasonCode
    confidence: float
    raw_cosine: float
    calibration: Calibration
    bands: str = BANDS_TWO

    @property
    def hr_alert(self) -> bool:
        """Whether Person 3 should push a WebSocket alert to the dashboard.

        Anything that did not cleanly approve is worth a human looking at,
        under either band model.
        """
        return self.decision is not Decision.APPROVED

    def thresholds(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "approve": self.calibration.approve,
            "bands": self.bands,
            "calibration_version": self.calibration.calibration_version,
            "approve_at_cosine": round(
                self.calibration.cosine_for_confidence(self.calibration.approve), 4
            ),
        }
        if self.bands == BANDS_THREE:
            payload["flag"] = self.calibration.flag
            payload["flag_at_cosine"] = round(
                self.calibration.cosine_for_confidence(self.calibration.flag), 4
            )
        return payload


def decide(
    reference: np.ndarray,
    live: np.ndarray,
    calibration: Calibration,
    *,
    bands: str = BANDS_TWO,
) -> ScoreResult:
    """Compare two embeddings and produce a banded decision.

    Both band models approve at the same score -- the master plan's "85% or
    higher" -- and differ only in what happens below it:

    ``two`` (master plan, Quadrant IV)
        ``confidence >= approve`` -> approved; otherwise rejected, with an HR
        alert raised for manual audit.

    ``three`` (FR-07, "otherwise it is flagged for HR review")
        adds an intermediate band that is flagged rather than rejected, so a
        borderline employee is checked in pending approval instead of being
        turned away at the door.

    The choice is a policy question, not a modelling one, which is why it is a
    setting rather than a constant.
    """
    if bands not in (BANDS_TWO, BANDS_THREE):
        raise ValueError(f"bands must be {BANDS_TWO!r} or {BANDS_THREE!r}, got {bands!r}")

    cosine = cosine_similarity(reference, live)
    confidence = calibration.confidence(cosine)

    if confidence >= calibration.approve:
        decision, reason = Decision.APPROVED, ReasonCode.OK_MATCH
    elif bands == BANDS_THREE and confidence >= calibration.flag:
        decision, reason = Decision.FLAGGED, ReasonCode.LOW_CONFIDENCE
    else:
        decision, reason = Decision.REJECTED, ReasonCode.NO_MATCH

    return ScoreResult(
        decision=decision,
        reason_code=reason,
        confidence=round(confidence, 2),
        raw_cosine=round(cosine, 4),
        calibration=calibration,
        bands=bands,
    )
