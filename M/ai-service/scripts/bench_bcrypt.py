#!/usr/bin/env python3
"""Measure bcrypt cost against the check-in latency budget.

**Run this on the deployed container, not on a laptop.** Half a shared vCPU
instance is roughly an order of magnitude slower than a development machine,
and PIN verification sits directly inside the three-second check-in budget
(blueprint section 11). A cost that feels instant locally can eat seconds in
production.

    python scripts/bench_bcrypt.py
    python scripts/bench_bcrypt.py --budget-ms 150 --max-cost 13

Record the chosen cost and the measured milliseconds in ``docs/SECURITY.md``.
"""

from __future__ import annotations

import argparse
import platform
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

#: Share of the 3-second end-to-end budget that PIN hashing may consume.
DEFAULT_BUDGET_MS = 200.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-cost", type=int, default=8)
    parser.add_argument("--max-cost", type=int, default=13)
    parser.add_argument("--budget-ms", type=float, default=DEFAULT_BUDGET_MS)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()

    try:
        import bcrypt  # noqa: F401
    except ImportError as exc:
        raise SystemExit("bcrypt is not installed. Run: pip install -r requirements.txt") from exc

    from app.config import Settings
    from app.crypto.pin import benchmark_cost

    settings = Settings(pin_pepper_raw="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

    print(f"platform : {platform.platform()}")
    print(f"python   : {platform.python_version()}")
    print(f"budget   : {args.budget_ms:.0f} ms per verification\n")
    print(f"{'cost':>5}  {'ms':>9}  verdict")
    print("-" * 42)

    recommended: int | None = None
    for cost in range(args.min_cost, args.max_cost + 1):
        milliseconds = benchmark_cost(settings, cost, rounds=args.rounds) * 1000.0
        if milliseconds <= args.budget_ms:
            verdict = "ok"
            recommended = cost
        else:
            verdict = "over budget"
        print(f"{cost:>5}  {milliseconds:>9.1f}  {verdict}")

    print()
    if recommended is None:
        print(
            f"Nothing at cost >= {args.min_cost} fits a {args.budget_ms:.0f} ms budget on this "
            "machine. Either raise the budget or accept a slower check-in; do not silently "
            "drop below cost 8."
        )
        return 1

    print(f"Recommended: PNSM_BCRYPT_COST={recommended}")
    print(
        "\nRemember what this number does and does not buy. bcrypt raises the cost of "
        "cracking a stolen database. It does nothing against online guessing of a "
        "six-digit PIN -- that is what the pepper, the lockout and the rate limit are for."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
