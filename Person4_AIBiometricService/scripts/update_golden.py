#!/usr/bin/env python3
"""Regenerate the golden preprocessing fixture.

Run this **deliberately**, never to make a red build go green.  A changed
golden means the preprocessing pipeline moved, which means every similarity
score moved with it, which means the fitted calibration no longer describes
reality.  The correct sequence is:

1. decide the preprocessing change is right;
2. run ``python calibration/build_calibration.py`` to re-fit on the dataset;
3. run this script;
4. commit the new calibration and the new golden together.

    python scripts/update_golden.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from tests.golden.test_golden_vector import GOLDEN_PATH, compute_golden  # noqa: E402


def main() -> int:
    golden = compute_golden()
    previous = None
    if GOLDEN_PATH.exists():
        previous = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))

    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_text(json.dumps(golden, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {GOLDEN_PATH.relative_to(REPO_ROOT)}")
    print(f"  preprocess_fingerprint : {golden['preprocess_fingerprint']}")
    print(f"  tensor_sha256          : {golden['tensor_sha256']}")
    if previous and previous.get("preprocess_fingerprint") != golden["preprocess_fingerprint"]:
        print()
        print("  !! The preprocessing fingerprint changed.")
        print("     Re-fit the calibration before deploying, or every score is wrong:")
        print("       python calibration/build_calibration.py --dataset calibration/dataset")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
