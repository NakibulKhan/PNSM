"""ONNX Runtime session management.

Every option here exists to keep resident memory under the task's ceiling.  The
two decisions that matter most:

* **one global session per model**, created at startup.  Building a session per
  request is the classic way to OOM this service.
* **the CPU memory arena is disabled.**  ORT's arena pre-allocates far more
  than a single 112x112 inference needs, and on half a vCPU it buys
  nothing.

Reference: blueprint section 09.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Protocol

import numpy as np

from app.config import EMBEDDING_DIM

log = logging.getLogger(__name__)


class Embedder(Protocol):
    """Everything the pipeline needs from a recognition model."""

    @property
    def model_version(self) -> str: ...

    def embed(self, tensor: np.ndarray) -> np.ndarray: ...


def build_session_options():  # type: ignore[no-untyped-def]
    """Session options tuned for a single throttled vCPU."""
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    opts.inter_op_num_threads = 1
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.log_severity_level = 3  # warnings and above
    return opts


class OnnxEmbedder:
    """ArcFace recognition backbone executed through ONNX Runtime."""

    def __init__(self, model_path: Path, model_version: str) -> None:
        import onnxruntime as ort

        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(
                f"Recognition model not found at {path}. Run `python scripts/fetch_models.py`."
            )
        self._model_version = model_version
        self._session = ort.InferenceSession(
            str(path), build_session_options(), providers=["CPUExecutionProvider"]
        )
        inputs = self._session.get_inputs()
        outputs = self._session.get_outputs()
        if not inputs or not outputs:
            raise RuntimeError(f"{path} exposes no inputs or outputs")
        # Names are read from the graph rather than hard-coded: different
        # ArcFace exports use 'input.1', 'data' or 'input' interchangeably.
        self._input_name = inputs[0].name
        self._output_name = outputs[0].name
        self._input_shape = inputs[0].shape
        log.info(
            "recognition model loaded path=%s input=%s%s output=%s",
            path,
            self._input_name,
            self._input_shape,
            self._output_name,
        )

    @property
    def model_version(self) -> str:
        return self._model_version

    def embed(self, tensor: np.ndarray) -> np.ndarray:
        """Run inference on a ``(1, 3, H, W)`` tensor and return a 512-d vector."""
        if tensor.ndim != 4 or tensor.shape[0] != 1 or tensor.shape[1] != 3:
            raise ValueError(f"expected a (1, 3, H, W) tensor, got {tensor.shape}")
        raw = self._session.run(
            [self._output_name], {self._input_name: tensor.astype(np.float32)}
        )[0]
        vector = np.asarray(raw, dtype=np.float32).ravel()
        if vector.shape != (EMBEDDING_DIM,):
            raise RuntimeError(
                f"model returned {vector.shape[0]} dimensions, expected {EMBEDDING_DIM}. "
                "The configured model is not an ArcFace 512-d backbone."
            )
        return vector


class StubEmbedder:
    """Deterministic pseudo-embedder for tests and CI.

    Produces a stable unit vector derived from the tensor's own bytes: the same
    chip always yields the same vector, different chips yield near-orthogonal
    ones.  It exercises every code path around the model without pretending to
    recognise anybody -- results are meaningless for real faces, which is why
    ``ALLOW_STUB_MODELS`` logs a loud warning at boot.
    """

    def __init__(self, model_version: str = "stub_v1") -> None:
        self._model_version = model_version

    @property
    def model_version(self) -> str:
        return self._model_version

    def embed(self, tensor: np.ndarray) -> np.ndarray:
        if tensor.ndim != 4 or tensor.shape[0] != 1 or tensor.shape[1] != 3:
            raise ValueError(f"expected a (1, 3, H, W) tensor, got {tensor.shape}")
        quantised = np.round(np.asarray(tensor, dtype=np.float32), 3).tobytes()
        seed = int.from_bytes(hashlib.sha256(quantised).digest()[:8], "big")
        rng = np.random.default_rng(seed)
        vector = rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
        return vector / np.linalg.norm(vector)


def build_embedder(model_path: Path, model_version: str, *, allow_stub: bool) -> Embedder:
    """Choose an embedder, preferring the real model."""
    if allow_stub and not Path(model_path).exists():
        log.warning("recognition weights absent and ALLOW_STUB_MODELS is set; using StubEmbedder")
        return StubEmbedder()
    return OnnxEmbedder(model_path, model_version)
