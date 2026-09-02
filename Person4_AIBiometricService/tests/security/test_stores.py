"""TTL, history and rate-limit stores.

The bounds tests matter as much as the behaviour tests: an unbounded replay
cache is itself a denial-of-service vector inside a 1 GB task.
"""

from __future__ import annotations

from app.security.stores import InMemoryTTLStore, RecentValues, SlidingWindowRateLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_ttl_store_accepts_a_key_once() -> None:
    store = InMemoryTTLStore()
    assert store.add_if_absent("a", 60) is True
    assert store.add_if_absent("a", 60) is False
    assert store.contains("a")


def test_ttl_store_forgets_after_expiry() -> None:
    clock = FakeClock()
    store = InMemoryTTLStore(clock=clock)
    store.add_if_absent("a", 60)
    clock.advance(61)
    assert not store.contains("a")
    assert store.add_if_absent("a", 60) is True


def test_ttl_store_is_bounded() -> None:
    store = InMemoryTTLStore(max_entries=100)
    for index in range(1000):
        store.add_if_absent(f"k{index}", 3600)
    assert len(store) <= 100


def test_recent_values_detects_repeats_within_the_window() -> None:
    history = RecentValues(window=3)
    assert history.seen_or_add("alice", "x") is False
    assert history.seen_or_add("alice", "x") is True


def test_recent_values_rolls_the_window() -> None:
    history = RecentValues(window=2)
    history.seen_or_add("alice", "a")
    history.seen_or_add("alice", "b")
    history.seen_or_add("alice", "c")  # evicts "a"
    assert history.seen_or_add("alice", "a") is False


def test_recent_values_is_per_key() -> None:
    history = RecentValues(window=5)
    history.seen_or_add("alice", "x")
    assert history.seen_or_add("bob", "x") is False


def test_a_zero_window_disables_history() -> None:
    history = RecentValues(window=0)
    assert history.seen_or_add("alice", "x") is False
    assert history.seen_or_add("alice", "x") is False


def test_recent_values_bounds_the_number_of_keys() -> None:
    history = RecentValues(window=5, max_keys=20)
    for index in range(200):
        history.seen_or_add(f"user-{index}", "x")
    assert len(history._data) <= 20


def test_rate_limiter_allows_up_to_the_limit() -> None:
    limiter = SlidingWindowRateLimiter(limit=3, clock=FakeClock())
    assert [limiter.allow("alice") for _ in range(4)] == [True, True, True, False]


def test_rate_limiter_window_slides() -> None:
    clock = FakeClock()
    limiter = SlidingWindowRateLimiter(limit=2, window_s=60, clock=clock)
    limiter.allow("alice")
    limiter.allow("alice")
    assert limiter.allow("alice") is False
    clock.advance(61)
    assert limiter.allow("alice") is True


def test_rate_limiter_is_per_key() -> None:
    limiter = SlidingWindowRateLimiter(limit=1, clock=FakeClock())
    assert limiter.allow("alice") is True
    assert limiter.allow("bob") is True
    assert limiter.allow("alice") is False


def test_rate_limiter_bounds_tracked_keys() -> None:
    limiter = SlidingWindowRateLimiter(limit=5, max_keys=25, clock=FakeClock())
    for index in range(400):
        limiter.allow(f"user-{index}")
    assert len(limiter._hits) <= 25
