"""Small in-process stores for replay, lockout and rate limiting.

The service runs a single uvicorn worker (blueprint section 09), so in-process
state is *correct*, not merely convenient -- there is no second worker to fall
out of sync with.  A Redis-backed implementation is provided behind the same
protocol for the day the service scales past one instance; nothing above this
module changes when it is swapped in.

Every store takes an injectable clock so the time-dependent behaviour can be
tested without sleeping.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from typing import Protocol

Clock = Callable[[], float]


class TTLStore(Protocol):
    """A set with per-entry expiry."""

    def add_if_absent(self, key: str, ttl_s: int) -> bool: ...

    def contains(self, key: str) -> bool: ...


class InMemoryTTLStore:
    """Thread-safe TTL set with bounded size.

    Entries are evicted lazily on access and eagerly once ``max_entries`` is
    exceeded, so a burst of traffic cannot grow this without limit -- an
    unbounded replay cache is itself a denial-of-service vector on a 1 GB
    instance.
    """

    def __init__(self, *, max_entries: int = 50_000, clock: Clock = time.monotonic) -> None:
        self._data: OrderedDict[str, float] = OrderedDict()
        self._lock = threading.Lock()
        self._max_entries = max_entries
        self._clock = clock

    def _purge_locked(self, now: float) -> None:
        while self._data:
            _, expires = next(iter(self._data.items()))
            if expires > now:
                break
            self._data.popitem(last=False)
        while len(self._data) > self._max_entries:
            self._data.popitem(last=False)

    def add_if_absent(self, key: str, ttl_s: int) -> bool:
        """Insert ``key``. Returns ``True`` if it was new, ``False`` if seen."""
        now = self._clock()
        with self._lock:
            self._purge_locked(now)
            existing = self._data.get(key)
            if existing is not None and existing > now:
                return False
            self._data[key] = now + ttl_s
            self._data.move_to_end(key)
            return True

    def contains(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            self._purge_locked(now)
            expires = self._data.get(key)
            return expires is not None and expires > now

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            self._purge_locked(self._clock())
            return len(self._data)


class RecentValues:
    """Bounded per-key history, used for the image-replay guard.

    Keeping the last N image hashes per employee catches the attack that GPS,
    PIN and face-match all pass cleanly: resubmitting the same saved selfie
    every morning.
    """

    def __init__(self, *, window: int = 30, max_keys: int = 5_000) -> None:
        self._data: OrderedDict[str, deque[str]] = OrderedDict()
        self._lock = threading.Lock()
        self._window = window
        self._max_keys = max_keys

    def seen_or_add(self, key: str, value: str) -> bool:
        """Returns ``True`` if ``value`` was already in ``key``'s history."""
        if self._window <= 0:
            return False
        with self._lock:
            history = self._data.get(key)
            if history is None:
                history = deque(maxlen=self._window)
                self._data[key] = history
            self._data.move_to_end(key)
            while len(self._data) > self._max_keys:
                self._data.popitem(last=False)
            if value in history:
                return True
            history.append(value)
            return False

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class SlidingWindowRateLimiter:
    """Per-key sliding window limiter."""

    def __init__(
        self, *, limit: int, window_s: int = 60, max_keys: int = 5_000, clock: Clock = time.monotonic
    ) -> None:
        self._limit = limit
        self._window = window_s
        self._max_keys = max_keys
        self._clock = clock
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Record a hit. Returns ``False`` when the caller is over the limit."""
        now = self._clock()
        cutoff = now - self._window
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                hits = deque()
                self._hits[key] = hits
            self._hits.move_to_end(key)
            while len(self._hits) > self._max_keys:
                self._hits.popitem(last=False)
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self._limit:
                return False
            hits.append(now)
            return True

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()


class RedisTTLStore:  # pragma: no cover - exercised only with a live Redis
    """Drop-in :class:`TTLStore` for a multi-instance deployment.

    Not used by default. ``SET key 1 NX EX ttl`` is atomic, so the
    check-and-insert cannot race between instances.
    """

    def __init__(self, client: object, *, prefix: str = "pnsm:nonce:") -> None:
        self._client = client
        self._prefix = prefix

    def add_if_absent(self, key: str, ttl_s: int) -> bool:
        result = self._client.set(f"{self._prefix}{key}", "1", nx=True, ex=ttl_s)  # type: ignore[attr-defined]
        return bool(result)

    def contains(self, key: str) -> bool:
        return bool(self._client.exists(f"{self._prefix}{key}"))  # type: ignore[attr-defined]
