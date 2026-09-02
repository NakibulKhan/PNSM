"""The face engine: bytes in, embedding out.

Holds the detector, the shared preprocessing configuration and the embedder,
and applies the quality gate.  Everything above this layer works with vectors
and never touches OpenCV or ONNX Runtime directly.

Reference: blueprint section 05.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.ai.detect import FaceDetector
from app.ai.preprocess import PreprocessConfig, preprocess_face
from app.ai.quality import QualityMetrics, gate, measure
from app.ai.score import l2_normalise
from app.ai.session import Embedder
from app.config import Settings
from app.errors import PnsmError, ReasonCode

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbedResult:
    """A successful extraction."""

    vector: np.ndarray
    quality: QualityMetrics
    timings_ms: dict[str, float]


class FaceEngine:
    """Decode -> detect -> gate -> preprocess -> embed -> normalise."""

    def __init__(
        self,
        detector: FaceDetector,
        embedder: Embedder,
        settings: Settings,
        preprocess: PreprocessConfig,
    ) -> None:
        self._detector = detector
        self._embedder = embedder
        self._settings = settings
        self._preprocess = preprocess

    @property
    def model_version(self) -> str:
        return self._embedder.model_version

    @property
    def preprocess_config(self) -> PreprocessConfig:
        return self._preprocess

    def decode(self, payload: bytes) -> np.ndarray:
        """Decode image bytes to a BGR frame, enforcing the size ceiling."""
        if not payload:
            raise PnsmError(ReasonCode.UPSTREAM_STORAGE_ERROR, detail="empty image payload")
        if len(payload) > self._settings.max_upload_bytes:
            raise PnsmError(
                ReasonCode.PAYLOAD_TOO_LARGE,
                detail=f"{len(payload)} bytes exceeds {self._settings.max_upload_bytes}",
            )
        frame = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.size == 0:
            raise PnsmError(
                ReasonCode.NO_FACE_DETECTED, detail="payload is not a decodable image"
            )
        return frame

    def extract(self, payload: bytes, *, enrolment: bool) -> EmbedResult:
        """Full pipeline for one image.

        Raises:
            PnsmError: with the quality or detection reason code that failed.
        """
        timings: dict[str, float] = {}

        started = time.perf_counter()
        frame = self.decode(payload)
        timings["decode"] = (time.perf_counter() - started) * 1000.0

        started = time.perf_counter()
        detections = self._detector.detect(frame)
        timings["detect"] = (time.perf_counter() - started) * 1000.0

        if not detections:
            raise PnsmError(ReasonCode.NO_FACE_DETECTED, detail="detector returned no faces")

        primary = detections[0]

        started = time.perf_counter()
        tensor, chip = preprocess_face(frame, primary.landmarks, self._preprocess)
        timings["preprocess"] = (time.perf_counter() - started) * 1000.0

        metrics = measure(
            frame,
            chip,
            det_score=primary.score,
            box=primary.box,
            faces_found=len(detections),
        )
        failure = gate(metrics, self._settings, enrolment=enrolment)
        if failure is not None:
            raise PnsmError(
                failure,
                detail=f"quality gate: {metrics.as_dict()}",
                extra={"quality": metrics.as_dict()},
            )

        started = time.perf_counter()
        raw = self._embedder.embed(tensor)
        timings["infer"] = (time.perf_counter() - started) * 1000.0

        return EmbedResult(vector=l2_normalise(raw), quality=metrics, timings_ms=timings)

    def warmup(self) -> dict[str, Any]:
        """Run one synthetic inference so the first real check-in is not the
        request that pays first-call cost.

        Uses a synthetic chip rather than a bundled photograph: it exercises the
        identical tensor shape and graph without shipping anybody's face in the
        container image.
        """
        started = time.perf_counter()
        size = self._preprocess.size
        synthetic = np.zeros((1, 3, size, size), dtype=np.float32)
        vector = self._embedder.embed(synthetic)
        elapsed = (time.perf_counter() - started) * 1000.0
        log.info("warmup complete in %.1f ms (dim=%d)", elapsed, int(vector.shape[0]))
        return {"warm": True, "warmup_ms": round(elapsed, 1), "dim": int(vector.shape[0])}
