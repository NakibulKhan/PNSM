"""Alignment, equalisation and tensor construction.

The fingerprint tests are the ones that matter operationally: they are what
stops a preprocessing tweak from silently invalidating a fitted calibration.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.ai.preprocess import (
    ARCFACE_TEMPLATE,
    CHIP_SIZE,
    DEFAULT_PREPROCESS,
    PreprocessConfig,
    align_face,
    apply_clahe,
    normalise_landmark_order,
    preprocess_face,
    to_input_tensor,
    umeyama_similarity,
)
from tests.helpers import synthetic_frame


def _rotation(theta: float) -> np.ndarray:
    return np.array(
        [[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]], dtype=np.float64
    )


def test_umeyama_recovers_a_known_similarity_transform() -> None:
    scale, theta, shift = 1.7, 0.3, np.array([12.0, -5.0])
    source = ARCFACE_TEMPLATE.copy()
    target = (scale * (_rotation(theta) @ source.T)).T + shift

    matrix = umeyama_similarity(source, target)
    recovered = (matrix[:, :2] @ source.T).T + matrix[:, 2]
    assert np.allclose(recovered, target, atol=1e-9)


def test_umeyama_recovers_identity() -> None:
    matrix = umeyama_similarity(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE)
    assert np.allclose(matrix[:, :2], np.eye(2), atol=1e-9)
    assert np.allclose(matrix[:, 2], np.zeros(2), atol=1e-9)


def test_umeyama_is_deterministic() -> None:
    """Unlike the RANSAC variants, which is precisely why it is used here."""
    source = ARCFACE_TEMPLATE + np.array([3.0, -2.0])
    first = umeyama_similarity(source, ARCFACE_TEMPLATE)
    for _ in range(20):
        assert np.array_equal(first, umeyama_similarity(source, ARCFACE_TEMPLATE))


def test_umeyama_rejects_degenerate_input() -> None:
    with pytest.raises(ValueError):
        umeyama_similarity(np.zeros((5, 2)), ARCFACE_TEMPLATE)
    with pytest.raises(ValueError):
        umeyama_similarity(ARCFACE_TEMPLATE[:1], ARCFACE_TEMPLATE[:1])


def test_landmark_order_is_normalised_by_x() -> None:
    swapped = ARCFACE_TEMPLATE.copy()
    swapped[[0, 1]] = swapped[[1, 0]]
    swapped[[3, 4]] = swapped[[4, 3]]
    assert np.allclose(normalise_landmark_order(swapped), ARCFACE_TEMPLATE)


def test_landmark_normalisation_does_not_mutate_the_caller_array() -> None:
    original = ARCFACE_TEMPLATE.copy()
    original[[0, 1]] = original[[1, 0]]
    snapshot = original.copy()
    normalise_landmark_order(original)
    assert np.array_equal(original, snapshot)


def test_alignment_places_landmarks_on_the_template() -> None:
    """A face warped by a known transform must land back on the template."""
    frame = synthetic_frame()
    scale, theta, shift = 2.4, 0.15, np.array([180.0, 120.0])
    landmarks = (scale * (_rotation(theta) @ ARCFACE_TEMPLATE.T)).T + shift

    matrix = umeyama_similarity(landmarks, ARCFACE_TEMPLATE)
    mapped = (matrix[:, :2] @ landmarks.T).T + matrix[:, 2]
    assert np.allclose(mapped, ARCFACE_TEMPLATE, atol=1e-6)

    chip = align_face(frame, landmarks)
    assert chip.shape == (CHIP_SIZE, CHIP_SIZE, 3)


def test_tensor_shape_and_range() -> None:
    chip = np.full((CHIP_SIZE, CHIP_SIZE, 3), 255, dtype=np.uint8)
    tensor = to_input_tensor(chip)
    assert tensor.shape == (1, 3, CHIP_SIZE, CHIP_SIZE)
    assert tensor.dtype == np.float32
    assert tensor.min() >= -1.0 and tensor.max() <= 1.0
    # 255 -> (255 - 127.5) / 127.5 = 1.0
    assert tensor.max() == pytest.approx(1.0, abs=1e-6)

    black = to_input_tensor(np.zeros((CHIP_SIZE, CHIP_SIZE, 3), dtype=np.uint8))
    assert black.min() == pytest.approx(-1.0, abs=1e-6)


def test_tensor_is_rgb_not_bgr() -> None:
    """Channel order is a classic silent-wrongness bug; pin it down."""
    chip = np.zeros((CHIP_SIZE, CHIP_SIZE, 3), dtype=np.uint8)
    chip[:, :, 2] = 255  # pure red in BGR
    tensor = to_input_tensor(chip)
    assert tensor[0, 0].mean() == pytest.approx(1.0, abs=1e-6), "channel 0 must be R"
    assert tensor[0, 2].mean() == pytest.approx(-1.0, abs=1e-6), "channel 2 must be B"


def test_clahe_lifts_contrast_in_a_flat_region() -> None:
    chip = np.full((CHIP_SIZE, CHIP_SIZE, 3), 60, dtype=np.uint8)
    chip[40:70, 40:70] = 75
    equalised = apply_clahe(chip)
    assert equalised.std() > chip.std()


def test_clahe_can_be_disabled() -> None:
    chip = np.full((CHIP_SIZE, CHIP_SIZE, 3), 60, dtype=np.uint8)
    off = PreprocessConfig(clahe=False)
    assert np.array_equal(apply_clahe(chip, off), chip)


def test_preprocess_is_deterministic() -> None:
    """Enrolment and verification must produce byte-identical tensors."""
    frame = synthetic_frame(7)
    landmarks = ARCFACE_TEMPLATE * 2.0 + np.array([200.0, 150.0])
    first, _ = preprocess_face(frame, landmarks)
    for _ in range(5):
        again, _ = preprocess_face(frame, landmarks)
        assert np.array_equal(first, again)


def test_fingerprint_changes_when_any_knob_changes() -> None:
    baseline = DEFAULT_PREPROCESS.fingerprint()
    variants = [
        PreprocessConfig(clahe=False),
        PreprocessConfig(clahe_clip_limit=3.0),
        PreprocessConfig(clahe_tile_grid=4),
        PreprocessConfig(size=128),
        PreprocessConfig(pixel_mean=128.0),
        PreprocessConfig(interpolation="cubic"),
    ]
    fingerprints = {variant.fingerprint() for variant in variants}
    assert baseline not in fingerprints
    assert len(fingerprints) == len(variants), "each knob must move the fingerprint"


def test_fingerprint_is_stable_across_instances() -> None:
    assert PreprocessConfig().fingerprint() == PreprocessConfig().fingerprint()
