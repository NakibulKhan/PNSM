"""Loading and validating the score calibration.

The service refuses to start without a calibration file.  A silent default
would mean shipping an unknown decision threshold, and an unknown threshold is
exactly the failure this whole module exists to prevent.

Reference: blueprint section 04.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class CalibrationError(RuntimeError):
    """The calibration file is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class Calibration:
    """A fitted mapping from raw cosine similarity to displayed confidence.

    ``confidence = 100 / (1 + exp(-a * (cos - b)))``

    ``b`` is the decision midpoint chosen at a measured false-accept rate;
    ``a`` is the slope.  Both are fitted on the team's own photographs by
    ``calibration/build_calibration.py``.
    """

    calibration_version: str
    model_version: str
    a: float
    b: float
    approve: float
    flag: float
    measured: dict[str, Any] = field(default_factory=dict)
    fitted_at: str = ""
    source_path: str = ""

    def confidence(self, cosine: float) -> float:
        """Map a cosine similarity in [-1, 1] to a confidence in [0, 100]."""
        if not math.isfinite(cosine):
            return 0.0
        z = -self.a * (cosine - self.b)
        # Guard the exponential: at |z| > 700 the float64 exp overflows, and
        # the answer is already saturated to 0 or 100 anyway.
        if z > 700.0:
            return 0.0
        if z < -700.0:
            return 100.0
        return 100.0 / (1.0 + math.exp(z))

    def cosine_for_confidence(self, confidence: float) -> float:
        """Inverse map. Answers 'what cosine does 85% actually correspond to?'"""
        if confidence <= 0.0:
            return -1.0
        if confidence >= 100.0:
            return 1.0
        p = confidence / 100.0
        return self.b + math.log(p / (1.0 - p)) / self.a

    def summary(self) -> dict[str, Any]:
        """Operator-facing description, safe to expose on /ready."""
        return {
            "calibration_version": self.calibration_version,
            "model_version": self.model_version,
            "logistic": {"a": round(self.a, 4), "b": round(self.b, 4)},
            "bands": {"approve": self.approve, "flag": self.flag},
            "approve_at_cosine": round(self.cosine_for_confidence(self.approve), 4),
            "flag_at_cosine": round(self.cosine_for_confidence(self.flag), 4),
            "measured": self.measured,
            "fitted_at": self.fitted_at,
        }


def _require(obj: dict[str, Any], key: str, path: Path) -> Any:
    if key not in obj:
        raise CalibrationError(f"{path}: missing required field {key!r}")
    return obj[key]


def load_calibration(
    path: Path,
    *,
    approve_override: float | None = None,
    flag_override: float | None = None,
    expected_model_version: str | None = None,
) -> Calibration:
    """Read, validate and return the calibration.

    Environment overrides for the two band thresholds are honoured so that a
    threshold can be nudged live during a demo without refitting.
    """
    if not path.exists():
        raise CalibrationError(
            f"Calibration file not found at {path}. "
            "Run `python calibration/build_calibration.py --help` to build one."
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CalibrationError(f"{path}: not valid JSON ({exc})") from exc
    if not isinstance(data, dict):
        raise CalibrationError(f"{path}: top level must be a JSON object")

    logistic = _require(data, "logistic", path)
    if not isinstance(logistic, dict):
        raise CalibrationError(f"{path}: 'logistic' must be an object")
    a = float(_require(logistic, "a", path))
    b = float(_require(logistic, "b", path))
    if not math.isfinite(a) or a <= 0:
        raise CalibrationError(f"{path}: logistic.a must be a positive finite number, got {a}")
    if not math.isfinite(b) or not (-1.0 <= b <= 1.0):
        raise CalibrationError(f"{path}: logistic.b must lie in [-1, 1], got {b}")

    bands = data.get("bands") or {}
    approve = float(approve_override if approve_override is not None else bands.get("approve", 85.0))
    flag = float(flag_override if flag_override is not None else bands.get("flag", 60.0))
    if not (0.0 <= flag < approve <= 100.0):
        raise CalibrationError(
            f"{path}: bands must satisfy 0 <= flag ({flag}) < approve ({approve}) <= 100"
        )

    model_version = str(_require(data, "model_version", path))
    if expected_model_version is not None and model_version != expected_model_version:
        raise CalibrationError(
            f"{path}: calibration was fitted for model {model_version!r} but the service "
            f"is configured for {expected_model_version!r}. Refit before deploying -- a "
            "calibration is only valid for the model it was measured on."
        )

    return Calibration(
        calibration_version=str(data.get("calibration_version", "unversioned")),
        model_version=model_version,
        a=a,
        b=b,
        approve=approve,
        flag=flag,
        measured=dict(data.get("measured") or {}),
        fitted_at=str(data.get("fitted_at", "")),
        source_path=str(path),
    )
