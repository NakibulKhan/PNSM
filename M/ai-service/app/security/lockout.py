"""Per-employee PIN lockout.

This -- not bcrypt -- is the control that actually stops online guessing of a
six-digit PIN.  bcrypt raises the cost of cracking a *stolen database*; lockout
raises the cost of guessing against the live service from roughly a million
cheap attempts to a few per quarter hour.

Reference: blueprint sections 00 (correction 3) and 06.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

Clock = Callable[[], float]


@dataclass(frozen=True)
class LockoutState:
    """Current standing of one employee's PIN attempts."""

    locked: bool
    attempts_used: int
    attempts_left: int
    retry_after_s: int

    def as_dict(self) -> dict[str, int | bool]:
        return {
            "locked": self.locked,
            "attempts_left": self.attempts_left,
            "retry_after_s": self.retry_after_s,
        }


class LockoutPolicy:
    """Counts consecutive PIN failures and locks the account when they pile up."""

    def __init__(
        self,
        *,
        max_attempts: int,
        lockout_seconds: int,
        max_keys: int = 10_000,
        clock: Clock = time.monotonic,
    ) -> None:
        self._max_attempts = max_attempts
        self._lockout_seconds = lockout_seconds
        self._max_keys = max_keys
        self._clock = clock
        self._state: OrderedDict[str, tuple[int, float]] = OrderedDict()  # key -> (fails, until)
        self._lock = threading.Lock()

    def _touch_locked(self, key: str) -> tuple[int, float]:
        entry = self._state.get(key)
        if entry is None:
            entry = (0, 0.0)
            self._state[key] = entry
        self._state.move_to_end(key)
        while len(self._state) > self._max_keys:
            self._state.popitem(last=False)
        return entry

    def status(self, key: str) -> LockoutState:
        """Read current standing without recording an attempt."""
        now = self._clock()
        with self._lock:
            fails, until = self._touch_locked(key)
            if until > now:
                return LockoutState(True, fails, 0, round(until - now))
            if until:  # expired lockout: reset on read so the next attempt is clean
                self._state[key] = (0, 0.0)
                fails = 0
            return LockoutState(False, fails, max(self._max_attempts - fails, 0), 0)

    def register_failure(self, key: str) -> LockoutState:
        """Record a wrong PIN and lock the account if the budget is spent."""
        now = self._clock()
        with self._lock:
            fails, until = self._touch_locked(key)
            if until > now:
                return LockoutState(True, fails, 0, round(until - now))
            fails += 1
            if fails >= self._max_attempts:
                until = now + self._lockout_seconds
                self._state[key] = (fails, until)
                return LockoutState(True, fails, 0, self._lockout_seconds)
            self._state[key] = (fails, 0.0)
            return LockoutState(False, fails, self._max_attempts - fails, 0)

    def register_success(self, key: str) -> LockoutState:
        """Clear the counter after a correct PIN."""
        with self._lock:
            self._state.pop(key, None)
        return LockoutState(False, 0, self._max_attempts, 0)

    def clear(self) -> None:
        with self._lock:
            self._state.clear()
