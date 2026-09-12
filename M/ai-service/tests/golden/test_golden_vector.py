"""Golden-vector regression.

This is the highest-leverage test in the suite.  The failure the module is most
likely to ship is a preprocessing change -- a CLAHE tile size, a resize flag, a
channel order -- that shifts every score by a few points without raising
anything.  Nothing crashes; matches simply get worse and the calibration
quietly stops describing reality.

Pinning the preprocessing output turns that silent regression into a red build.

Regenerate deliberately, never reflexively:

    python scripts/update_golden.py

and re-fit the calibration afterwards, because a changed pipeline invalidates it.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from app.ai.preprocess import ARCFACE_TEMPLATE, DEFAULT_PREPROCESS, preprocess_face
from tests.helpers import synthetic_frame

GOLDEN_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "golden.json"

#: Fixed landmarks, so the test measures preprocessing rather than detection.
GOLDEN_LANDMARKS = ARCFACE_TEMPLATE * 2.4 + np.array([180.0, 120.0])
GOLDEN_SEED = 42


def compute_golden() -> dict[str, object]:
    """Deterministic fingerprint of the preprocessing output."""
    frame = synthetic_frame(GOLDEN_SEED)
    tensor, chip = preprocess_face(frame, GOLDEN_LANDMARKS, DEFAULT_PREPROCESS)
    return {
        "preprocess_fingerprint": DEFAULT_PREPROCESS.fingerprint(),
        "tensor_sha256": hashlib.sha256(np.ascontiguousarray(tensor).tobytes()).hexdigest(),
        "chip_sha256": hashlib.sha256(np.ascontiguousarray(chip).tobytes()).hexdigest(),
        "tensor_shape": list(tensor.shape),
        "tensor_mean": round(float(tensor.mean()), 6),
        "tensor_std": round(float(tensor.std()), 6),
    }


def test_preprocessing_output_matches_the_committed_golden() -> None:
    assert GOLDEN_PATH.exists(), (
        "tests/fixtures/golden.json is missing. Generate it with "
        "`python scripts/update_golden.py`."
    )
    expected = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    actual = compute_golden()

    if actual["preprocess_fingerprint"] != expected["preprocess_fingerprint"]:
        raise AssertionError(
            "The preprocessing configuration changed "
            f"({expected['preprocess_fingerprint']} -> {actual['preprocess_fingerprint']}). "
            "Every score shifts with it, so the fitted calibration is no longer valid. "
            "Re-fit with calibration/build_calibration.py, then regenerate this golden "
            "with scripts/update_golden.py."
        )
    if actual["tensor_sha256"] != expected["tensor_sha256"]:
        raise AssertionError(
            "Preprocessing produced different pixels for an unchanged configuration. "
            "Something in align/CLAHE/normalise changed behaviour -- an OpenCV upgrade, "
            "an interpolation flag, or a channel order. Investigate before regenerating."
        )
    assert actual["chip_sha256"] == expected["chip_sha256"]
    assert actual["tensor_shape"] == expected["tensor_shape"]


def test_preprocessing_is_stable_within_a_single_run() -> None:
    first = compute_golden()
    for _ in range(3):
        assert compute_golden() == first


def test_tensor_statistics_stay_in_the_model_input_range() -> None:
    frame = synthetic_frame(GOLDEN_SEED)
    tensor, _ = preprocess_face(frame, GOLDEN_LANDMARKS, DEFAULT_PREPROCESS)
    assert tensor.dtype == np.float32
    assert tensor.min() >= -1.0
    assert tensor.max() <= 1.0
