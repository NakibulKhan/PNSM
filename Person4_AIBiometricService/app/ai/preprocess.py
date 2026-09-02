"""The single shared preprocessing path.

Enrolment and verification **must** call the same function with the same
configuration.  A divergence between the two paths -- a different CLAHE tile
size, a different interpolation flag, a different channel order -- shifts every
score by a few points without raising anything.  Nothing crashes; matches
simply get worse, and the calibration silently stops describing reality.

Two structural guards exist against that:

* this module exposes exactly one entry point, :func:`preprocess_face`;
* :meth:`PreprocessConfig.fingerprint` is recorded in ``calibration.json`` and
  re-checked at boot, so a changed pipeline refuses to run against a stale fit.

Reference: blueprint section 05.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from typing import Any, Final

import cv2
import numpy as np

#: ArcFace's canonical 5-point destination template for a 112x112 chip.
#: Order: image-left eye, image-right eye, nose tip, image-left mouth corner,
#: image-right mouth corner. Taken from the InsightFace reference alignment.
ARCFACE_TEMPLATE: Final[np.ndarray] = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float64,
)

CHIP_SIZE: Final[int] = 112


@dataclass(frozen=True)
class PreprocessConfig:
    """Every knob that can move a score. Fingerprinted into the calibration."""

    size: int = CHIP_SIZE
    clahe: bool = True
    clahe_clip_limit: float = 2.0
    clahe_tile_grid: int = 8
    #: ArcFace normalisation: (pixel - mean) / std, applied per channel.
    pixel_mean: float = 127.5
    pixel_std: float = 127.5
    interpolation: str = "linear"

    def fingerprint(self) -> str:
        """Short stable hash of the configuration."""
        blob = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["fingerprint"] = self.fingerprint()
        return payload


DEFAULT_PREPROCESS = PreprocessConfig()

_INTERPOLATION = {
    "linear": cv2.INTER_LINEAR,
    "cubic": cv2.INTER_CUBIC,
    "area": cv2.INTER_AREA,
}


def umeyama_similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform mapping ``src`` onto ``dst``.

    Implements Umeyama (1991) -- the same estimator ``skimage`` uses and that
    InsightFace's reference alignment relies on.  Deterministic, unlike the
    RANSAC/LMEDS variants of ``cv2.estimateAffinePartial2D``, which is what we
    want: alignment must be bit-for-bit reproducible between enrolment and
    verification.

    Args:
        src: ``(N, 2)`` source points.
        dst: ``(N, 2)`` destination points.

    Returns:
        A ``(2, 3)`` affine matrix suitable for :func:`cv2.warpAffine`.
    """
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 2:
        raise ValueError(f"src and dst must both be (N, 2); got {src.shape} and {dst.shape}")
    num, dim = src.shape
    if num < 2:
        raise ValueError("at least two point correspondences are required")

    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_demean = src - src_mean
    dst_demean = dst - dst_mean

    covariance = dst_demean.T @ src_demean / num
    d = np.ones((dim,), dtype=np.float64)
    if np.linalg.det(covariance) < 0:
        d[dim - 1] = -1.0

    u, s, vt = np.linalg.svd(covariance)
    rank = np.linalg.matrix_rank(covariance)
    if rank == 0:
        raise ValueError("degenerate point configuration: covariance has rank 0")

    if rank == dim - 1:
        if np.linalg.det(u) * np.linalg.det(vt) > 0:
            rotation = u @ vt
        else:
            saved = d[dim - 1]
            d[dim - 1] = -1.0
            rotation = u @ np.diag(d) @ vt
            d[dim - 1] = saved
    else:
        rotation = u @ np.diag(d) @ vt

    variance = src_demean.var(axis=0).sum()
    if variance <= 0:
        raise ValueError("degenerate point configuration: source points are coincident")
    scale = float(s @ d) / variance

    matrix = np.eye(3, dtype=np.float64)
    matrix[:dim, :dim] = scale * rotation
    matrix[:dim, dim] = dst_mean - scale * (rotation @ src_mean)
    return matrix[:2, :]


def normalise_landmark_order(landmarks: np.ndarray) -> np.ndarray:
    """Force landmarks into the template's image-coordinate ordering.

    Detectors disagree about whether "right eye" means the subject's right or
    the viewer's right.  For the near-frontal faces this service accepts (the
    quality gate rejects anything else), ordering by x-coordinate within the
    eye pair and within the mouth pair is unambiguous and makes the pipeline
    independent of that convention.
    """
    pts = np.asarray(landmarks, dtype=np.float64).reshape(5, 2).copy()
    if pts[0, 0] > pts[1, 0]:
        pts[[0, 1]] = pts[[1, 0]]
    if pts[3, 0] > pts[4, 0]:
        pts[[3, 4]] = pts[[4, 3]]
    return pts


def align_face(
    image: np.ndarray, landmarks: np.ndarray, cfg: PreprocessConfig = DEFAULT_PREPROCESS
) -> np.ndarray:
    """Warp the face onto the canonical template. Returns a BGR chip."""
    if image is None or image.size == 0:
        raise ValueError("image is empty")
    pts = normalise_landmark_order(landmarks)
    scale = cfg.size / CHIP_SIZE
    matrix = umeyama_similarity(pts, ARCFACE_TEMPLATE * scale)
    return cv2.warpAffine(
        image,
        matrix,
        (cfg.size, cfg.size),
        flags=_INTERPOLATION[cfg.interpolation],
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )


def apply_clahe(chip: np.ndarray, cfg: PreprocessConfig = DEFAULT_PREPROCESS) -> np.ndarray:
    """Contrast-limited adaptive histogram equalisation on the aligned chip.

    Equalising the *chip* rather than the whole frame is deliberate: on a full
    photograph a bright window dominates the histogram and washes the face out.
    Running after alignment means CLAHE sees exactly the pixels the model will.

    CLAHE shifts the input distribution away from what ArcFace was trained on.
    That is harmless here because it is applied identically at enrolment and at
    verification, and because the calibration in section 04 is fitted on this
    exact pipeline -- any shift is absorbed by the fit.
    """
    if not cfg.clahe:
        return chip
    grey = cv2.cvtColor(chip, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(
        clipLimit=cfg.clahe_clip_limit,
        tileGridSize=(cfg.clahe_tile_grid, cfg.clahe_tile_grid),
    )
    equalised = clahe.apply(grey)
    return cv2.cvtColor(equalised, cv2.COLOR_GRAY2BGR)


def to_input_tensor(chip: np.ndarray, cfg: PreprocessConfig = DEFAULT_PREPROCESS) -> np.ndarray:
    """BGR chip -> ``(1, 3, size, size)`` float32 NCHW tensor in [-1, 1]."""
    rgb = cv2.cvtColor(chip, cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb = (rgb - cfg.pixel_mean) / cfg.pixel_std
    return np.transpose(rgb, (2, 0, 1))[np.newaxis, ...].astype(np.float32)


def preprocess_face(
    image: np.ndarray,
    landmarks: np.ndarray,
    cfg: PreprocessConfig = DEFAULT_PREPROCESS,
) -> tuple[np.ndarray, np.ndarray]:
    """The one shared path: align, equalise, normalise.

    Args:
        image: Full BGR frame as decoded by OpenCV.
        landmarks: ``(5, 2)`` facial landmarks in frame coordinates.
        cfg: Preprocessing configuration. Must match the calibration.

    Returns:
        ``(tensor, chip)`` -- the model input and the aligned BGR chip. The
        chip is returned so callers can compute quality metrics or debug
        alignment without repeating the warp.
    """
    chip = align_face(image, landmarks, cfg)
    chip = apply_clahe(chip, cfg)
    return to_input_tensor(chip, cfg), chip
