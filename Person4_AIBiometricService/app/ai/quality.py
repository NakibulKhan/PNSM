"""Image quality gating.

A bad reference photo poisons every future check-in for that employee, so
enrolment holds a higher bar than verification.  Returning these numbers to the
caller lets Person 2's onboarding form reject a blurry or backlit upload at
capture time, when it can still be retaken.

Reference: blueprint section 03 (quality metrics) and section 05 (stage 4).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import cv2
import numpy as np

from app.config import Settings
from app.errors import ReasonCode


@dataclass(frozen=True)
class QualityMetrics:
    """Measured properties of one detected face."""

    det_score: float
    blur_var: float
    face_area_ratio: float
    brightness: float
    faces_found: int

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        return {
            "det_score": round(payload["det_score"], 4),
            "blur_var": round(payload["blur_var"], 2),
            "face_area_ratio": round(payload["face_area_ratio"], 4),
            "brightness": round(payload["brightness"], 2),
            "faces_found": payload["faces_found"],
        }


def blur_variance(chip: np.ndarray) -> float:
    """Variance of the Laplacian -- the standard focus measure.

    Higher is sharper. Computed on the aligned chip so the number is
    independent of how much background the frame happened to contain.
    """
    grey = cv2.cvtColor(chip, cv2.COLOR_BGR2GRAY) if chip.ndim == 3 else chip
    return float(cv2.Laplacian(grey, cv2.CV_64F).var())


def mean_brightness(chip: np.ndarray) -> float:
    """Mean luma in [0, 255]."""
    grey = cv2.cvtColor(chip, cv2.COLOR_BGR2GRAY) if chip.ndim == 3 else chip
    return float(np.mean(grey))


def measure(
    frame: np.ndarray,
    chip: np.ndarray,
    *,
    det_score: float,
    box: tuple[float, float, float, float],
    faces_found: int,
) -> QualityMetrics:
    """Build the metric set for one face.

    Args:
        frame: The full decoded frame, used for the area ratio.
        chip: The aligned 112x112 chip, used for blur and brightness.
        det_score: Detector confidence in [0, 1].
        box: ``(x, y, w, h)`` bounding box in frame coordinates.
        faces_found: How many faces the detector returned.
    """
    frame_area = float(frame.shape[0] * frame.shape[1]) or 1.0
    _, _, w, h = box
    return QualityMetrics(
        det_score=float(det_score),
        blur_var=blur_variance(chip),
        face_area_ratio=float(max(w, 0.0) * max(h, 0.0)) / frame_area,
        brightness=mean_brightness(chip),
        faces_found=int(faces_found),
    )


def gate(metrics: QualityMetrics, settings: Settings, *, enrolment: bool) -> ReasonCode | None:
    """Return the reason a face fails the quality bar, or ``None`` if it passes.

    Checks run in the order a user can most easily act on: framing first
    (move closer), then focus (hold still), then light (move somewhere
    brighter).
    """
    min_det = settings.enrol_min_det_score if enrolment else settings.min_det_score
    min_blur = settings.enrol_min_blur_var if enrolment else settings.min_blur_var
    min_area = settings.enrol_min_face_area_ratio if enrolment else settings.min_face_area_ratio

    if metrics.faces_found == 0:
        return ReasonCode.NO_FACE_DETECTED
    if metrics.faces_found > 1:
        return ReasonCode.MULTIPLE_FACES
    if metrics.det_score < min_det:
        return ReasonCode.NO_FACE_DETECTED
    if metrics.face_area_ratio < min_area:
        return ReasonCode.FACE_TOO_SMALL
    if metrics.blur_var < min_blur:
        return ReasonCode.IMAGE_TOO_BLURRY
    if metrics.brightness < settings.min_brightness or metrics.brightness > settings.max_brightness:
        return ReasonCode.IMAGE_TOO_DARK
    return None


def warnings_for(metrics: QualityMetrics, settings: Settings) -> list[str]:
    """Non-fatal advice returned alongside a successful enrolment."""
    notes: list[str] = []
    if metrics.blur_var < settings.enrol_min_blur_var * 1.5:
        notes.append("Reference photo is soft. A sharper photo improves match reliability.")
    if metrics.brightness < 90:
        notes.append("Reference photo is dim. Brighter, even lighting improves match reliability.")
    if metrics.brightness > 185:
        notes.append("Reference photo is bright and may be losing facial detail.")
    if metrics.face_area_ratio < settings.enrol_min_face_area_ratio * 2:
        notes.append("Face is small in frame. A closer portrait improves match reliability.")
    return notes
