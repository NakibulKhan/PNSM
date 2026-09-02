"""PIN lockout -- the control that actually stops online guessing."""

from __future__ import annotations

from app.security.lockout import LockoutPolicy


class FakeClock:
    """Injectable time so lockout expiry is tested without sleeping."""

    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_policy(clock: FakeClock | None = None, **overrides) -> LockoutPolicy:
    base = {"max_attempts": 5, "lockout_seconds": 900}
    base.update(overrides)
    return LockoutPolicy(clock=clock or FakeClock(), **base)


def test_a_fresh_account_has_the_full_budget() -> None:
    state = make_policy().status("alice")
    assert not state.locked
    assert state.attempts_left == 5


def test_the_budget_decrements_with_each_failure() -> None:
    policy = make_policy()
    assert [policy.register_failure("alice").attempts_left for _ in range(4)] == [4, 3, 2, 1]


def test_the_account_locks_when_the_budget_is_spent() -> None:
    policy = make_policy(max_attempts=3)
    policy.register_failure("alice")
    policy.register_failure("alice")
    final = policy.register_failure("alice")
    assert final.locked
    assert final.attempts_left == 0
    assert final.retry_after_s == 900


def test_further_attempts_while_locked_do_not_extend_the_lockout() -> None:
    """A lock that renews on every attempt is a denial-of-service on the employee."""
    clock = FakeClock()
    policy = make_policy(clock, max_attempts=2, lockout_seconds=900)
    policy.register_failure("alice")
    policy.register_failure("alice")
    clock.advance(600)
    still = policy.register_failure("alice")
    assert still.locked
    assert still.retry_after_s <= 300


def test_the_lock_expires_on_its_own() -> None:
    clock = FakeClock()
    policy = make_policy(clock, max_attempts=2, lockout_seconds=900)
    policy.register_failure("alice")
    policy.register_failure("alice")
    assert policy.status("alice").locked

    clock.advance(901)
    recovered = policy.status("alice")
    assert not recovered.locked
    assert recovered.attempts_left == 2


def test_a_correct_pin_clears_the_counter() -> None:
    policy = make_policy(max_attempts=5)
    policy.register_failure("alice")
    policy.register_failure("alice")
    assert policy.register_success("alice").attempts_left == 5
    assert policy.status("alice").attempts_left == 5


def test_lockout_is_per_employee() -> None:
    policy = make_policy(max_attempts=2)
    policy.register_failure("alice")
    policy.register_failure("alice")
    assert policy.status("alice").locked
    assert not policy.status("bob").locked


def test_state_is_bounded_so_traffic_cannot_exhaust_memory() -> None:
    policy = make_policy(max_keys=50)
    for index in range(500):
        policy.register_failure(f"user-{index}")
    assert len(policy._state) <= 50
