#!/usr/bin/env python3
"""Measure resident memory with the real ONNX sessions loaded.

The CI gate in ``tests/memory`` runs against the stub embedder, so it measures
the service's own footprint and stays green on a machine with no weights. This
script measures the whole picture -- weights, sessions, buffers -- and is the
number that decides whether the container survives its Fargate memory limit.

    python scripts/bench_memory.py
    python scripts/bench_memory.py --iterations 200

Run it inside the container for a number that means something:

    docker run --rm -m 1024m --entrypoint python pnsm-ai-svc scripts/bench_memory.py
"""

from __future__ import annotations

import argparse
import gc
import statistics
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

CEILING_MB = 512.0
#: Leave room for the OS, the ASGI server and a request burst.
TARGET_MB = 380.0


def rss_mb() -> float:
    import psutil

    return psutil.Process().memory_info().rss / (1024 * 1024)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--iterations", type=int, default=50)
    parser.add_argument("--stub", action="store_true", help="use the stub embedder instead of real weights")
    args = parser.parse_args()

    stages: list[tuple[str, float]] = []

    stages.append(("interpreter", rss_mb()))
    import numpy  # noqa: F401

    stages.append(("+ numpy", rss_mb()))
    import cv2  # noqa: F401

    stages.append(("+ opencv-headless", rss_mb()))
    import onnxruntime  # noqa: F401

    stages.append(("+ onnxruntime", rss_mb()))

    from app.ai.detect import StubDetector, YuNetDetector
    from app.ai.engine import FaceEngine
    from app.ai.preprocess import DEFAULT_PREPROCESS
    from app.ai.session import OnnxEmbedder, StubEmbedder
    from app.config import Settings

    # Thirty-two zero bytes. Not a secret and not usable as one: this benchmark
    # loads ONNX sessions and measures resident memory, and Settings refuses to
    # construct without values of the right shape.
    ALL_ZERO_PLACEHOLDER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

    settings = Settings(
        fle_keys_raw='{"k1":"' + ALL_ZERO_PLACEHOLDER + '"}',
        pin_pepper_raw=ALL_ZERO_PLACEHOLDER,
        hmac_secret_raw=ALL_ZERO_PLACEHOLDER,
        allow_stub_models=True,
        min_blur_var=1.0,
    )

    if args.stub or not settings.rec_model_path.exists():
        if not args.stub:
            print("Weights not found; falling back to the stub. Run scripts/fetch_models.py first.\n")
        detector, embedder = StubDetector(), StubEmbedder()
    else:
        detector = YuNetDetector(settings.det_model_path)
        stages.append(("+ detector session", rss_mb()))
        embedder = OnnxEmbedder(settings.rec_model_path, settings.model_version)
        stages.append(("+ recognition session", rss_mb()))

    engine = FaceEngine(detector, embedder, settings, DEFAULT_PREPROCESS)
    engine.warmup()
    gc.collect()
    stages.append(("+ warmup", rss_mb()))

    sys.path.insert(0, str(REPO_ROOT))
    from tests.helpers import synthetic_jpeg

    payloads = [synthetic_jpeg(seed) for seed in range(5)]
    for payload in payloads:
        engine.extract(payload, enrolment=False)
    gc.collect()
    baseline = rss_mb()
    stages.append(("+ first requests", baseline))

    durations: list[float] = []
    peak = baseline
    for index in range(args.iterations):
        started = time.perf_counter()
        engine.extract(payloads[index % len(payloads)], enrolment=False)
        durations.append((time.perf_counter() - started) * 1000.0)
        peak = max(peak, rss_mb())

    gc.collect()
    final = rss_mb()

    print(f"{'stage':<26}{'RSS MB':>10}{'delta':>10}")
    print("-" * 46)
    previous = 0.0
    for label, value in stages:
        print(f"{label:<26}{value:>10.1f}{value - previous:>10.1f}")
        previous = value

    print("-" * 46)
    print(f"{'peak over run':<26}{peak:>10.1f}")
    print(f"{'final':<26}{final:>10.1f}")
    print(f"{'growth':<26}{final - baseline:>10.1f}")
    print()
    durations.sort()
    print(f"latency p50 : {statistics.median(durations):8.1f} ms")
    print(f"latency p95 : {durations[int(0.95 * (len(durations) - 1))]:8.1f} ms")
    print(f"latency max : {durations[-1]:8.1f} ms")
    print()
    headroom = CEILING_MB - peak
    print(f"ceiling {CEILING_MB:.0f} MB, target {TARGET_MB:.0f} MB, headroom {headroom:.1f} MB")

    if peak > TARGET_MB:
        print(
            "\nOVER TARGET. Check for a heavy import (tensorflow, torch, non-headless opencv), "
            "a session built per request, or an unbounded cache."
        )
        return 1
    print("\nWithin budget.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
