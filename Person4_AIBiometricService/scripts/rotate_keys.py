#!/usr/bin/env python3
"""Re-wrap stored envelopes under a new key or a new key provider.

Two jobs, one mechanism:

**Migration.** Envelopes sealed before the AWS move carry ``kp: "static"`` and a
key that lives in an environment variable.  The master plan requires the keys to
live in KMS.  Re-wrapping moves them there without a single employee re-enrolling
-- the plaintext embedding is decrypted and re-encrypted in this process's
memory and never leaves it.

**Rotation.** The same operation with the same provider and a newer active key
version is a key rotation, which is what you run after a suspected key exposure.

Envelopes belong to Person 3's ``FaceEmbeddings`` collection, so this tool works
on a file rather than reaching into a database that is not Person 4's to touch:

    # Person 3 exports
    mongoexport --collection FaceEmbeddings --out embeddings.json

    # Person 4 re-wraps
    python scripts/rotate_keys.py --in embeddings.json --out rewrapped.json --to kms

    # Person 3 imports, having kept the export as a rollback
    mongoimport --collection FaceEmbeddings --mode upsert --file rewrapped.json

Each record must carry the employee reference the envelope was sealed against,
because that reference is inside the AES-GCM additional authenticated data.  A
record whose ``user_id`` does not match will fail to open -- loudly, which is the
correct outcome: it means the export and the envelopes disagree about who is who.

Safety properties, in order of importance:

* Nothing is written until every record has been re-wrapped successfully.
  A half-migrated collection is far worse than an unmigrated one.
* Every re-wrapped envelope is opened again and compared to the original vector
  before it is accepted.  An envelope that cannot be read back is a lost
  enrolment, and the check costs microseconds.
* The input file is never modified.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from app.config import Settings, get_settings  # noqa: E402
from app.crypto import fle  # noqa: E402
from app.crypto.keyproviders import KeyProvider, build_key_provider  # noqa: E402

#: Where the employee reference lives on an exported record. Person 3's schema.
USER_FIELD = "user_id"
#: Where the envelope lives on an exported record.
ENVELOPE_FIELD = "envelope"


class RotationError(RuntimeError):
    """The input is unusable, or a re-wrap could not be verified."""


def load_records(path: Path) -> list[dict[str, Any]]:
    """Read either a JSON array or one JSON object per line (mongoexport's default)."""
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise RotationError(f"{path} is empty")
    if text.startswith("["):
        data = json.loads(text)
        if not isinstance(data, list):
            raise RotationError(f"{path} is JSON but not an array of records")
        return data
    records = []
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise RotationError(f"{path} line {number} is not valid JSON: {exc}") from exc
    return records


def extract(record: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    user_ref = record.get(USER_FIELD)
    envelope = record.get(ENVELOPE_FIELD)
    if not isinstance(user_ref, str) or not user_ref:
        raise RotationError(f"record is missing a string {USER_FIELD!r}: {sorted(record)}")
    if not isinstance(envelope, dict):
        raise RotationError(f"record {user_ref} is missing an {ENVELOPE_FIELD!r} object")
    return user_ref, envelope


def rewrap_record(
    record: dict[str, Any], *, source: KeyProvider, target: KeyProvider
) -> dict[str, Any]:
    """Re-wrap one record and prove the result still opens to the same vector."""
    user_ref, envelope = extract(record)

    original = fle.open_envelope(envelope, user_ref=user_ref, provider=source)
    rewrapped = fle.rewrap(envelope, user_ref=user_ref, source=source, target=target)
    restored = fle.open_envelope(rewrapped, user_ref=user_ref, provider=target)

    if not np.array_equal(original, restored):
        # Unreachable short of a bug in fle, which is exactly why it is checked.
        raise RotationError(
            f"re-wrapped envelope for {user_ref} does not decrypt to the original vector. "
            "Nothing has been written. Do not import; report this."
        )

    updated = dict(record)
    updated[ENVELOPE_FIELD] = rewrapped
    return updated


def build_target(settings: Settings, to: str, key_id: str, active_key: str) -> KeyProvider:
    """The provider envelopes are being moved *to*."""
    overrides: dict[str, Any] = {"key_provider": to}
    if key_id:
        overrides["kms_key_id"] = key_id
    if active_key:
        overrides["fle_active_key"] = active_key
    return build_key_provider(settings.model_copy(update=overrides))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--in", dest="source_path", required=True, type=Path)
    parser.add_argument("--out", dest="target_path", type=Path)
    parser.add_argument(
        "--to",
        default="",
        choices=["", "kms", "static"],
        help="target key provider (default: the same one, i.e. a key rotation)",
    )
    parser.add_argument("--kms-key-id", default="", help="CMK ARN or alias, for --to kms")
    parser.add_argument(
        "--active-key",
        default="",
        help="target key version, for a static-to-static rotation (e.g. k2)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="re-wrap and verify everything, write nothing. Always run this first.",
    )
    args = parser.parse_args(argv)

    if not args.dry_run and not args.target_path:
        parser.error("--out is required unless --dry-run is given")

    try:
        settings = get_settings()
        source = build_key_provider(settings)
        target = build_target(settings, args.to or settings.key_provider, args.kms_key_id, args.active_key)

        records = load_records(args.source_path)
        print(f"read {len(records)} record(s) from {args.source_path}")
        print(f"re-wrapping {source.name} -> {target.name}")

        # Everything is re-wrapped in memory first. Writing as we go would leave
        # a partially migrated file behind on the first bad record.
        rewrapped: list[dict[str, Any]] = []
        skipped = 0
        for record in records:
            _, envelope = extract(record)
            already_current = (
                envelope.get("kp", "static") == target.name
                and envelope.get("kv") == target.active_key_id
            )
            if already_current:
                # Re-wrapping it would be harmless but not free, and a rerun
                # after a partial import must be cheap enough that nobody is
                # tempted to skip it.
                skipped += 1
                rewrapped.append(record)
                continue
            rewrapped.append(rewrap_record(record, source=source, target=target))

        migrated = len(records) - skipped
        print(f"verified {migrated} re-wrapped envelope(s); {skipped} already current")

        if args.dry_run:
            print("\ndry run: nothing written. Re-run with --out to produce the file.")
            return 0

        args.target_path.write_text(
            "\n".join(json.dumps(r) for r in rewrapped) + "\n", encoding="utf-8"
        )
        print(f"wrote {args.target_path}")
        print(
            "\nKeep the input file until the import is confirmed: it is the rollback.\n"
            "Keep the OLD keys available until every envelope reports the new provider --\n"
            "they are what opens anything the import misses."
        )
        return 0
    except (RotationError, fle.EnvelopeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
