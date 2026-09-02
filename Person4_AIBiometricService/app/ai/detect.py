"""Face detection and 5-point landmarks.

Uses OpenCV's bundled **YuNet** detector rather than hand-written SCRFD
post-processing.  The blueprint named SCRFD; YuNet is a deliberate improvement
on that plan for three reasons:

* it emits the five landmarks ArcFace alignment needs, natively;
* anchor decoding and NMS live inside OpenCV, so roughly 120 lines of the
  most bug-prone code in the pipeline simply do not exist here;
* the model is ~233 KB rather than 2.5 MB, which matters on a small task.

Detection accuracy for the near-frontal, cooperative faces this service sees is
equivalent.  The deviation is recorded in ``docs/DECISIONS.md``.

Reference: blueprint section 05.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

#: Frames larger than this on their long edge are downscaled before detection.
#: Keeps detection time bounded and makes results independent of camera
#: resolution; landmarks are scaled back to original coordinates afterwards.
MAX_DETECT_EDGE = 1024


@dataclass(frozen=True)
class Detection:
    """One detected face in original-frame coordinates."""

    box: tuple[float, float, float, float]  # x, y, w, h
    landmarks: np.ndarray  # (5, 2) float64
    score: float

    @property
    def area(self) -> float:
        return max(self.box[2], 0.0) * max(self.box[3], 0.0)


class FaceDetector(Protocol):
    """Everything the pipeline needs from a detector."""

    def detect(self, image: np.ndarray) -> list[Detection]: ...


def _scale_frame(image: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= MAX_DETECT_EDGE:
        return image, 1.0
    factor = MAX_DETECT_EDGE / float(longest)
    resized = cv2.resize(
        image, (round(width * factor), round(height * factor)), interpolation=cv2.INTER_AREA
    )
    return resized, factor


class YuNetDetector:
    """OpenCV YuNet, wrapped so the rest of the code never touches cv2 state."""

    def __init__(
        self,
        model_path: Path,
        *,
        score_threshold: float = 0.6,
        nms_threshold: float = 0.3,
        top_k: int = 50,
    ) -> None:
        if not Path(model_path).exists():
            raise FileNotFoundError(
                f"Detector model not found at {model_path}. Run `python scripts/fetch_models.py`."
            )
        self._model_path = str(model_path)
        self._score_threshold = score_threshold
        # Input size is replaced per frame; (320, 320) is just a valid seed.
        self._detector = cv2.FaceDetectorYN.create(
            model=self._model_path,
            config="",
            input_size=(320, 320),
            score_threshold=score_threshold,
            nms_threshold=nms_threshold,
            top_k=top_k,
        )

    def detect(self, image: np.ndarray) -> list[Detection]:
        if image is None or image.size == 0:
            return []
        frame, factor = _scale_frame(image)
        height, width = frame.shape[:2]
        self._detector.setInputSize((width, height))
        _, raw = self._detector.detect(frame)
        if raw is None:
            return []

        inverse = 1.0 / factor
        results: list[Detection] = []
        for row in raw:
            values = np.asarray(row, dtype=np.float64).ravel()
            if values.size < 15:
                continue
            x, y, w, h = (values[:4] * inverse).tolist()
            landmarks = values[4:14].reshape(5, 2) * inverse
            results.append(
                Detection(box=(x, y, w, h), landmarks=landmarks, score=float(values[14]))
            )
        results.sort(key=lambda d: d.area, reverse=True)
        return results


class StubDetector:
    """Deterministic detector for tests and CI, where no weights are present.

    Reports one face occupying the central 60% of the frame with landmarks
    placed on the ArcFace template proportions. It exercises every downstream
    code path without pretending to detect anything.
    """

    def __init__(self, *, score: float = 0.99, faces: int = 1) -> None:
        self._score = score
        self._faces = faces

    def detect(self, image: np.ndarray) -> list[Detection]:
        if image is None or image.size == 0 or self._faces == 0:
            return []
        height, width = image.shape[:2]
        box_w, box_h = width * 0.6, height * 0.6
        x0, y0 = (width - box_w) / 2.0, (height - box_h) / 2.0
        # Template proportions mapped into the box, so alignment is a
        # well-conditioned, near-identity similarity transform.
        from app.ai.preprocess import ARCFACE_TEMPLATE, CHIP_SIZE

        landmarks = ARCFACE_TEMPLATE / CHIP_SIZE * np.array([box_w, box_h]) + np.array([x0, y0])
        base = Detection(box=(x0, y0, box_w, box_h), landmarks=landmarks, score=self._score)
        if self._faces == 1:
            return [base]
        extra = Detection(
            box=(0.0, 0.0, box_w * 0.4, box_h * 0.4),
            landmarks=landmarks * 0.4,
            score=self._score * 0.9,
        )
        return [base, extra][: self._faces]


def build_detector(model_path: Path, *, allow_stub: bool) -> FaceDetector:
    """Choose a detector, preferring the real one."""
    if allow_stub and not Path(model_path).exists():
        return StubDetector()
    return YuNetDetector(model_path)
