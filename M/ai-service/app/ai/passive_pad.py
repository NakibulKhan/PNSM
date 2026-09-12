"""Passive single-frame Presentation Attack Detection heuristics (Item 3b,
Flawless/Ultra blueprint).

Both blueprints describe passive CNN analysis detecting "screen moire
patterns" and "unnatural edge blending" as a *second*, independent PAD signal
alongside active illumination (app/services/liveness.py). A trained
anti-spoofing CNN is out of scope here -- there is no labeled
attack-instrument dataset to train or validate one against -- but the
underlying classical computer-vision signals it is meant to catch are real
and measurable with the libraries this service already depends on
(opencv-python-headless, numpy):

* A re-photographed screen or printed halftone produces a periodic pattern
  (moire, or the print's dot grid) that concentrates energy in the mid
  spatial frequencies of a 2D FFT -- a genuine face's natural skin/hair
  texture does not.
* A digital replay or a low-resolution print is measurably softer than a
  live, in-focus capture -- exactly the Laplacian-variance sharpness measure
  app.ai.quality already computes for the enrolment/check-in quality gate,
  reused here rather than re-implemented.

These are real heuristic signals, not a certified detection rate and not a
trained model -- documented as such, and never used alone to reject a
check-in (see app/services/verify.py, which folds this into the overall
decision alongside the face-match score).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.ai.quality import blur_variance
from app.config import Settings

#: Frequencies below this radius (in FFT bins, on a 256x256-normalised
#: spectrum) are excluded: overall brightness and smooth gradients dominate
#: there for every image, live or not, and would swamp the ratio.
_LOW_FREQ_CUTOFF = 8
#: Frequencies above this radius are excluded too: sensor noise lives out
#: here regardless of whether the subject is a live face or a replay, so it
#: is not a discriminating signal.
_HIGH_FREQ_CUTOFF = 80
_FFT_SIZE = 256


@dataclass(frozen=True)
class PassivePadResult:
    moire_energy_ratio: float
    edge_sharpness: float
    confidence: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "moire_energy_ratio": self.moire_energy_ratio,
            "edge_sharpness": self.edge_sharpness,
            "confidence": self.confidence,
        }


def moire_energy_ratio(image: np.ndarray) -> float:
    """Fraction of 2D FFT magnitude energy sitting in the mid spatial-frequency band.

    Higher means more suspicious: a periodic grid pattern (screen moire, print
    halftone) concentrates energy there in a way a live face's texture does not.
    """
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    grey = cv2.resize(grey.astype(np.float32), (_FFT_SIZE, _FFT_SIZE))

    spectrum = np.fft.fftshift(np.fft.fft2(grey))
    magnitude = np.abs(spectrum)

    yy, xx = np.mgrid[0:_FFT_SIZE, 0:_FFT_SIZE]
    center = _FFT_SIZE // 2
    radius = np.sqrt((yy - center) ** 2 + (xx - center) ** 2)
    mid_band = (radius >= _LOW_FREQ_CUTOFF) & (radius < _HIGH_FREQ_CUTOFF)

    total_energy = float(magnitude.sum()) or 1.0
    mid_band_energy = float(magnitude[mid_band].sum())
    return round(mid_band_energy / total_energy, 4)


def analyze(image: np.ndarray, settings: Settings) -> PassivePadResult:
    """Score one frame's moire and edge-sharpness signals into a bounded confidence.

    Not a certified detection rate -- a starting point to tune against real
    captures, combining two independent 0-1 components equally. Neither
    threshold below has been fitted against a labeled attack-instrument
    dataset (none exists here); they are documented defaults, not measured
    ones (compare app/ai/calibration.py's own honest BOOTSTRAP warning for
    the face-match threshold, which has the same limitation).
    """
    moire = moire_energy_ratio(image)
    sharpness = blur_variance(image)

    moire_baseline = settings.passive_pad_moire_baseline
    moire_component = max(0.0, 1.0 - moire / moire_baseline) if moire_baseline > 0 else 1.0
    sharpness_component = min(1.0, sharpness / settings.min_blur_var) if settings.min_blur_var > 0 else 1.0

    confidence = round(100.0 * (0.5 * moire_component + 0.5 * sharpness_component), 1)
    return PassivePadResult(moire_energy_ratio=moire, edge_sharpness=round(sharpness, 2), confidence=confidence)
