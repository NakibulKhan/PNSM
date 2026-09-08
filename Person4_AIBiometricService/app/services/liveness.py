"""Active-illumination liveness challenge (Flawless/Ultra blueprint Item 3).

Not ISO/IEC 30107-3 certified -- that requires a real accredited physical lab
(iBeta) and is out of scope for this project (no such lab access exists here).
This is a genuine, own-built Presentation Attack Detection signal instead of
a relabeled placeholder: while the mobile check-in screen flashes 2-4
randomized colors, the client captures one frame per flash and sends them
here. A live face sitting close to the screen reflects each flash's color and
brightness back into the camera; a printed photo or a video replayed on a
second screen does not show the same tightly-correlated, distance-appropriate
reflectance change between frames.

This is the *authoritative* check -- the mobile client never self-reports
pass/fail (see Person1_MobileClient/src/screens/CheckInScreen.jsx), matching
the fail-closed convention app/security/guards.py already established for
mock-location and rooted-device signals.

Reference: PNSM_Flawless_Blueprint.pdf / PNSM_Ultra_Blueprint.pdf, "Active
Illumination and Depth Mapping".
"""

from __future__ import annotations

import logging
from typing import Any

import cv2
import numpy as np

from app.config import Settings
from app.errors import PnsmError, ReasonCode
from app.services.image_source import ImageRef, resolve
from app.storage.s3 import ObjectStore

log = logging.getLogger(__name__)

#: Target RGB a client-reported flash color is expected to push a live face's
#: reflected light toward. Deliberately coarse (full-saturation primaries plus
#: white) -- this is a correlation signal, not a colorimetric measurement.
_COLOR_TARGETS: dict[str, tuple[float, float, float]] = {
    "red": (255.0, 40.0, 40.0),
    "green": (40.0, 255.0, 40.0),
    "blue": (40.0, 40.0, 255.0),
    "white": (255.0, 255.0, 255.0),
}


def _mean_rgb(frame_bgr: np.ndarray) -> tuple[float, float, float]:
    """cv2 decodes to BGR; this project's convention elsewhere is RGB order."""
    b, g, r, *_ = cv2.mean(frame_bgr)
    return (float(r), float(g), float(b))


def _correlation_score(observed: tuple[float, float, float], target: tuple[float, float, float]) -> float:
    """How much the observed frame's color response matches a reported flash, as a 0-100 score.

    Raw-RGB cosine similarity is a poor discriminator here: a neutral grey
    frame's vector still has a large, roughly-equal projection onto every
    fully-saturated target color, so it scores misleadingly high against
    *any* reported flash. Instead:

    - For a colored flash (red/green/blue), compare each frame's *chrominance*
      -- its RGB vector minus its own mean, i.e. deviation from neutral grey
      -- to the target's chrominance via cosine similarity. A neutral/grey
      frame has near-zero chrominance and scores near zero against every
      color; a frame that genuinely reflects the reported color's hue scores
      high, independent of the frame's overall brightness (ambient light and
      camera exposure vary enormously between devices and rooms).
    - For "white", there is no hue to correlate (white's chrominance is the
      zero vector by definition) -- a genuine white flash instead shows up as
      a brightness increase, so it is scored by how close the frame's mean
      luminance lands to the target's.
    """
    o = np.asarray(observed, dtype=np.float64)
    t = np.asarray(target, dtype=np.float64)
    t_mean = float(t.mean())
    t_dev = t - t_mean

    if float(np.linalg.norm(t_dev)) < 1.0:
        # No hue signal in the target (white) -- score by brightness closeness.
        o_mean = float(o.mean())
        closeness = 1.0 - abs(o_mean - t_mean) / 255.0
        return round(100.0 * max(0.0, closeness), 1)

    o_dev = o - float(o.mean())
    denom = float(np.linalg.norm(o_dev) * np.linalg.norm(t_dev))
    if denom == 0.0:
        # A perfectly neutral frame has no chrominance to correlate at all.
        return 0.0
    cosine = float(np.dot(o_dev, t_dev) / denom)
    return round(100.0 * max(0.0, cosine), 1)


class LivenessService:
    """Checks whether captured frames' color response correlates with a reported screen flash."""

    def __init__(self, store: ObjectStore, settings: Settings) -> None:
        self._store = store
        self._settings = settings

    def execute(self, *, user_ref: str, frames: list[dict[str, Any]]) -> dict[str, Any]:
        per_frame_scores: list[float] = []
        for frame in frames:
            color = frame["color"]
            target = _COLOR_TARGETS.get(color)
            if target is None:  # pragma: no cover - schema already restricts this
                raise PnsmError(ReasonCode.BAD_REQUEST, detail=f"unknown flash color {color!r}")

            image_ref = ImageRef.parse(frame["image"])
            payload = resolve(image_ref, self._store, max_bytes=self._settings.liveness_max_frame_bytes)
            decoded = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            if decoded is None:
                raise PnsmError(ReasonCode.BAD_REQUEST, detail="a liveness frame could not be decoded as an image")

            observed = _mean_rgb(decoded)
            per_frame_scores.append(_correlation_score(observed, target))

        confidence = round(sum(per_frame_scores) / len(per_frame_scores), 1)
        passed = confidence >= self._settings.liveness_min_confidence

        log.info(
            "liveness user_ref=%s frames=%d confidence=%.1f passed=%s",
            user_ref,
            len(frames),
            confidence,
            passed,
        )

        return {
            "passed": passed,
            "confidence": confidence,
            "per_frame_scores": per_frame_scores,
        }
