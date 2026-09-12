"""Passive PAD heuristics (Item 3b, Flawless/Ultra blueprint).

Real classical-CV signals (FFT moire ratio, Laplacian edge sharpness) -- not
a trained model, not ISO/IEC 30107-3 certified. These tests prove the
underlying math discriminates the cases it is meant to on synthetic inputs,
not that it passes certification (no such lab access exists here).
"""

from __future__ import annotations

import cv2
import numpy as np

from app.ai.passive_pad import analyze, moire_energy_ratio
from tests.helpers import make_settings, synthetic_frame


def _grid_pattern(size: int = 256, period: int = 6) -> np.ndarray:
    """A synthetic periodic grid -- the signature a re-photographed screen or
    printed halftone leaves, deliberately exaggerated so the test is robust."""
    yy, xx = np.mgrid[0:size, 0:size]
    grid = (((xx // period) + (yy // period)) % 2) * 255
    frame = np.stack([grid, grid, grid], axis=-1).astype(np.uint8)
    return frame


def _natural_like_frame(seed: int = 0, size: int = 256) -> np.ndarray:
    """1/f ("pink") noise -- real photographs have energy concentrated at low
    spatial frequencies (a well-documented natural-image statistic), unlike
    both a periodic grid (energy concentrated in a mid-band ring) and white
    noise (flat across all frequencies, which is itself an unnatural, highly
    suspicious spectrum). This is the honest synthetic stand-in for "looks
    like a real photo" that this test suite can build without a labeled
    photograph dataset."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((size, size))
    spectrum = np.fft.fftshift(np.fft.fft2(white))
    yy, xx = np.mgrid[0:size, 0:size]
    center = size // 2
    radius = np.sqrt((yy - center) ** 2 + (xx - center) ** 2)
    radius[center, center] = 1.0  # avoid a division by zero at DC
    pink_spectrum = spectrum / radius
    pink = np.real(np.fft.ifft2(np.fft.ifftshift(pink_spectrum)))
    pink -= pink.min()
    pink = (pink / (pink.max() or 1.0) * 255.0).astype(np.uint8)
    return np.stack([pink, pink, pink], axis=-1)


class TestMoireEnergyRatio:
    def test_a_periodic_grid_scores_a_higher_ratio_than_a_smooth_natural_frame(self) -> None:
        grid_ratio = moire_energy_ratio(_grid_pattern())
        smooth_ratio = moire_energy_ratio(_natural_like_frame(seed=1))
        assert grid_ratio > smooth_ratio

    def test_the_ratio_is_bounded_between_zero_and_one(self) -> None:
        for image in (_grid_pattern(), synthetic_frame(seed=2)):
            ratio = moire_energy_ratio(image)
            assert 0.0 <= ratio <= 1.0


class TestAnalyze:
    def test_a_natural_like_frame_scores_higher_confidence_than_a_grid_pattern(self) -> None:
        settings = make_settings()
        natural = analyze(_natural_like_frame(seed=3), settings)
        spoofed = analyze(_grid_pattern(), settings)
        assert natural.confidence > spoofed.confidence

    def test_a_heavily_blurred_frame_scores_lower_confidence_than_a_sharp_one(self) -> None:
        settings = make_settings()
        sharp = synthetic_frame(seed=4)
        soft = cv2.GaussianBlur(sharp, (0, 0), 12.0)
        assert analyze(sharp, settings).confidence > analyze(soft, settings).confidence

    def test_confidence_is_bounded_zero_to_one_hundred(self) -> None:
        settings = make_settings()
        for image in (_grid_pattern(), synthetic_frame(seed=5), np.zeros((64, 64, 3), dtype=np.uint8)):
            result = analyze(image, settings)
            assert 0.0 <= result.confidence <= 100.0

    def test_as_dict_round_trips_the_three_fields(self) -> None:
        result = analyze(synthetic_frame(seed=6), make_settings())
        body = result.as_dict()
        assert set(body) == {"moire_energy_ratio", "edge_sharpness", "confidence"}
