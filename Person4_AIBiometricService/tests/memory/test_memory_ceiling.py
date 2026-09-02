"""Resident memory gate.

The task's memory limit is the constraint the whole inference design is
built around.  Asserting it in CI is what stops a well-meaning ``pip install
deepface`` -- which pulls TensorFlow and blows the ceiling on import -- from
reaching a deployment.

The stub embedder is used deliberately: this test measures the *service's* own
footprint (OpenCV buffers, per-request allocations, the replay caches) rather
than the model weights, and it must therefore stay green on a machine with no
weights present. ``scripts/bench_memory.py`` measures the full picture with the
real ONNX sessions loaded.
"""

from __future__ import annotations

import gc

from tests.helpers import make_engine, make_settings, synthetic_jpeg

#: Ceiling for the service's own allocations, excluding model weights.
#: Budget from blueprint section 09: ~250 MB steady, ~305 MB peak, gate at 380.
RSS_CEILING_MB = 380.0
#: Growth across a sustained run. A steady climb means something is retained
#: per request -- the classic cause being a session built inside the handler.
GROWTH_CEILING_MB = 40.0
ITERATIONS = 50


def _rss_mb() -> float:
    import psutil

    return psutil.Process().memory_info().rss / (1024 * 1024)


def test_repeated_verification_stays_under_the_ceiling() -> None:
    settings = make_settings()
    engine = make_engine(settings)
    payloads = [synthetic_jpeg(seed) for seed in range(5)]

    # Warm every code path first so one-off allocations are not counted as growth.
    for payload in payloads:
        engine.extract(payload, enrolment=False)
    gc.collect()
    baseline = _rss_mb()

    peak = baseline
    for index in range(ITERATIONS):
        engine.extract(payloads[index % len(payloads)], enrolment=False)
        peak = max(peak, _rss_mb())

    gc.collect()
    final = _rss_mb()
    growth = final - baseline

    assert peak < RSS_CEILING_MB, (
        f"peak RSS {peak:.1f} MB exceeds the {RSS_CEILING_MB} MB gate. "
        "Check for a heavy import (tensorflow, torch, non-headless opencv) or a "
        "session being constructed per request."
    )
    assert growth < GROWTH_CEILING_MB, (
        f"RSS grew {growth:.1f} MB across {ITERATIONS} verifications "
        f"({baseline:.1f} -> {final:.1f}). Something is retained per request."
    )


def test_the_replay_caches_do_not_grow_without_bound() -> None:
    """An unbounded replay cache is itself a denial-of-service inside the limit."""
    from app.security.guards import SecurityGuards

    guards = SecurityGuards(
        max_clock_skew_s=120, nonce_ttl_s=600, image_replay_window=30, rate_limit_per_min=10_000
    )
    gc.collect()
    baseline = _rss_mb()
    for index in range(20_000):
        guards._nonces.add_if_absent(f"nonce-{index}", 600)
        guards._images.seen_or_add(f"user-{index % 200}", f"hash-{index}")
    gc.collect()
    assert _rss_mb() - baseline < GROWTH_CEILING_MB


def test_no_heavy_framework_is_importable_into_the_runtime() -> None:
    """The dependency blocklist, asserted rather than documented.

    ``deepface`` and ``insightface`` pull TensorFlow or PyTorch, which is
    precisely the out-of-memory failure the source risk matrix predicts.
    """
    import sys

    forbidden = {"tensorflow", "torch", "keras", "deepface", "insightface"}
    loaded = forbidden & set(sys.modules)
    assert not loaded, f"heavy frameworks loaded into the service runtime: {sorted(loaded)}"
