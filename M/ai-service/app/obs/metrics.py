"""Lightweight in-process metrics.

Deliberately not Prometheus: a client library plus its registry is another
dependency and another few megabytes of resident memory, and nothing here
scrapes it.  These counters exist to answer three questions -- is the service
being used, is it fast enough, is it near the memory ceiling -- and the last of
those is what the CI memory gate asserts against.

Reference: blueprint sections 09 and 12.
"""

from __future__ import annotations

import threading
import time
from collections import Counter, defaultdict
from typing import Any


class Metrics:
    """Counters plus a small latency summary, safe across threads."""

    def __init__(self, *, sample_cap: int = 512) -> None:
        self._lock = threading.Lock()
        self._counters: Counter[str] = Counter()
        self._latencies: dict[str, list[float]] = defaultdict(list)
        self._sample_cap = sample_cap
        self._started = time.monotonic()

    def incr(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self._counters[name] += amount

    def observe(self, name: str, milliseconds: float) -> None:
        with self._lock:
            samples = self._latencies[name]
            samples.append(milliseconds)
            # Reservoir-free bound: drop the oldest half rather than growing.
            if len(samples) > self._sample_cap:
                del samples[: self._sample_cap // 2]

    @staticmethod
    def _percentile(sorted_values: list[float], fraction: float) -> float:
        if not sorted_values:
            return 0.0
        index = min(len(sorted_values) - 1, max(0, round(fraction * (len(sorted_values) - 1))))
        return round(sorted_values[index], 2)

    def rss_mb(self) -> float:
        """Resident set size in MB, or 0.0 where psutil is unavailable."""
        try:
            import psutil

            return round(psutil.Process().memory_info().rss / (1024 * 1024), 2)
        except Exception:  # pragma: no cover - psutil missing or restricted
            return 0.0

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            counters = dict(self._counters)
            latencies = {
                name: {
                    "count": len(values),
                    "p50": self._percentile(sorted(values), 0.50),
                    "p95": self._percentile(sorted(values), 0.95),
                    "max": round(max(values), 2),
                }
                for name, values in self._latencies.items()
                if values
            }
        return {
            "uptime_s": round(time.monotonic() - self._started, 1),
            "rss_mb": self.rss_mb(),
            "counters": counters,
            "latency_ms": latencies,
        }

    def reset(self) -> None:
        with self._lock:
            self._counters.clear()
            self._latencies.clear()


#: Process-wide instance. One worker, so one registry.
METRICS = Metrics()
