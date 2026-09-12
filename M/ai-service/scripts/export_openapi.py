#!/usr/bin/env python3
"""Write ``docs/openapi.json`` from the live application.

This file is the contract Persons 1, 2 and 3 code against. Exporting it from
the running app rather than maintaining it by hand is what stops the document
and the service drifting apart.

    python scripts/export_openapi.py
    python scripts/export_openapi.py --check     # CI: fail if it is stale
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

OUTPUT = REPO_ROOT / "docs" / "openapi.json"

#: Placeholder secrets: the exporter builds the app, and the app refuses to
#: start without them. They never leave this process.
PLACEHOLDER = base64.b64encode(b"\x00" * 32).decode()


def build_spec() -> dict:
    os.environ.setdefault("PNSM_FLE_KEYS", json.dumps({"k1": PLACEHOLDER}))
    os.environ.setdefault("PNSM_PIN_PEPPER", PLACEHOLDER)
    os.environ.setdefault("PNSM_HMAC_SECRET", PLACEHOLDER)
    os.environ.setdefault("PNSM_ALLOW_STUB_MODELS", "true")
    os.environ.setdefault("PNSM_APP_ENV", "test")
    os.environ.setdefault("PNSM_CALIBRATION_PATH", str(REPO_ROOT / "calibration" / "calibration.json"))

    from app.config import reset_settings_cache
    from app.main import create_app

    reset_settings_cache()
    return create_app().openapi()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="exit non-zero if the committed file is stale")
    args = parser.parse_args()

    rendered = json.dumps(build_spec(), indent=2, sort_keys=True) + "\n"

    if args.check:
        if not OUTPUT.exists():
            print(
                f"{OUTPUT.relative_to(REPO_ROOT)} is missing.\n"
                "\n"
                "This is expected exactly once, on the first CI run after a fresh\n"
                "clone: the file is generated, not hand-written, and generating it\n"
                "needs FastAPI installed. Run\n"
                "\n"
                "  make openapi\n"
                "\n"
                "and commit the result. From then on this check catches an API\n"
                "that changed without the contract being re-exported -- which is\n"
                "the failure that breaks Persons 1, 2 and 3 simultaneously."
            )
            return 1
        if OUTPUT.read_text(encoding="utf-8") != rendered:
            print(
                f"{OUTPUT.relative_to(REPO_ROOT)} is out of date.\n"
                "The API changed without the contract being re-exported. Run:\n"
                "  python scripts/export_openapi.py\n"
                "then tell Persons 1, 2 and 3 what moved."
            )
            return 1
        print(f"{OUTPUT.relative_to(REPO_ROOT)} is current.")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered, encoding="utf-8")
    spec = json.loads(rendered)
    print(f"wrote {OUTPUT.relative_to(REPO_ROOT)}")
    print(f"  {len(spec['paths'])} paths, {len(spec.get('components', {}).get('schemas', {}))} schemas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
