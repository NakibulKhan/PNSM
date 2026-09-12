#!/usr/bin/env python3
"""Generate the four secrets this service needs.

    python scripts/gen_keys.py            # print a .env fragment
    python scripts/gen_keys.py --rotate   # add a new FLE key version

Run it once and paste the output into your ``.env`` for local work. For AWS,
put each value in Secrets Manager instead -- the ECS task definition resolves
them at task start, so they never appear in the task definition itself:

    aws secretsmanager create-secret --name pnsm/hmac-secret \
        --secret-string "<the value printed below>"

**Back up PNSM_FLE_KEYS somewhere outside the deployment platform.** If it is
lost, every embedding sealed under the static key provider becomes permanently
unreadable and those employees must re-enrol. That is a five-minute prevention
for an unrecoverable failure.

Under ``PNSM_KEY_PROVIDER=kms`` the data keys are minted and wrapped by AWS
KMS, so there is nothing here to lose -- but the FLE keys are still what opens
envelopes written before the migration. Keep them until
``scripts/rotate_keys.py`` reports every envelope re-wrapped.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets


def new_key() -> str:
    """32 bytes from the OS CSPRNG, base64 encoded."""
    return base64.b64encode(os.urandom(32)).decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rotate", action="store_true", help="add a key version to an existing PNSM_FLE_KEYS")
    parser.add_argument("--existing", default="", help="current PNSM_FLE_KEYS JSON, for --rotate")
    args = parser.parse_args()

    if args.rotate:
        current = json.loads(args.existing or os.environ.get("PNSM_FLE_KEYS", "{}"))
        if not current:
            raise SystemExit(
                "--rotate needs the current key map, via --existing or the PNSM_FLE_KEYS environment variable"
            )
        versions = sorted(int(k[1:]) for k in current if k.startswith("k") and k[1:].isdigit())
        next_version = f"k{(versions[-1] if versions else 0) + 1}"
        current[next_version] = new_key()
        print(f"PNSM_FLE_KEYS={json.dumps(current, separators=(',', ':'))}")
        print(f"PNSM_FLE_ACTIVE_KEY={next_version}")
        print()
        print("Rotation procedure:")
        print("  1. Deploy with both keys present and the new one active.")
        print("  2. New enrolments seal under the new key; old envelopes still open.")
        print("  3. Re-wrap old envelopes with app.crypto.fle.rewrap as they are read.")
        print("  4. Once none remain, remove the old key and redeploy.")
        return 0

    print("# --- pnsm-ai-svc secrets. Generated fresh; never commit this. ---")
    print(f'PNSM_FLE_KEYS={{"k1":"{new_key()}"}}')
    print("PNSM_FLE_ACTIVE_KEY=k1")
    print(f"PNSM_PIN_PEPPER={new_key()}")
    print(f"PNSM_HMAC_SECRET={new_key()}")
    print(f"PNSM_ADMIN_TOKEN={secrets.token_urlsafe(24)}")
    print()
    print("# Share PNSM_HMAC_SECRET with Person 3 only -- it is what lets their")
    print("# backend call this service, and nothing else should be able to.")
    print("# Back up PNSM_FLE_KEYS outside the deployment platform. Losing it")
    print("# means every employee must re-enrol.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
