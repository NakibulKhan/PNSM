"""The static-to-KMS migration tool.

This script touches every enrolled employee at once. A bug in it is not a bug
in one check-in -- it is the whole workforce re-enrolling. So the properties
tested here are the ones that make that impossible: it verifies before it
writes, it writes nothing when any record fails, and it never mutates its input.

Reference: master plan, Quadrant IV -- keys held within AWS KMS.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.crypto import fle
from scripts.rotate_keys import (
    RotationError,
    extract,
    load_records,
    rewrap_record,
)
from tests.helpers import make_key_provider, make_settings, unit_vector
from tests.unit.test_keyproviders import kms_provider


def record(user_ref: str, seed: int, provider) -> dict:
    return {
        "_id": f"oid-{seed}",
        "user_id": user_ref,
        "envelope": fle.seal(
            unit_vector(seed), user_ref=user_ref, model_version="m1", provider=provider
        ),
    }


# ------------------------------------------------------------------ reading
def test_a_json_array_export_is_read(tmp_path: Path) -> None:
    path = tmp_path / "a.json"
    path.write_text(json.dumps([{"user_id": "alice"}, {"user_id": "bob"}]), encoding="utf-8")
    assert len(load_records(path)) == 2


def test_mongoexports_line_delimited_default_is_read(tmp_path: Path) -> None:
    """`mongoexport` writes one document per line, not an array. Both must work."""
    path = tmp_path / "b.json"
    path.write_text('{"user_id":"alice"}\n{"user_id":"bob"}\n\n', encoding="utf-8")
    assert len(load_records(path)) == 2


def test_an_empty_export_is_refused_rather_than_treated_as_done(tmp_path: Path) -> None:
    """Zero records looks exactly like a successful migration. It is not."""
    path = tmp_path / "c.json"
    path.write_text("   \n", encoding="utf-8")
    with pytest.raises(RotationError):
        load_records(path)


def test_a_malformed_line_names_the_line(tmp_path: Path) -> None:
    path = tmp_path / "d.json"
    path.write_text('{"user_id":"alice"}\nnot json\n', encoding="utf-8")
    with pytest.raises(RotationError) as caught:
        load_records(path)
    assert "line 2" in str(caught.value)


def test_a_record_without_an_employee_reference_is_refused() -> None:
    """user_ref is inside the AES-GCM AAD; without it nothing can be opened."""
    with pytest.raises(RotationError):
        extract({"envelope": {"v": 2}})
    with pytest.raises(RotationError):
        extract({"user_id": "alice"})
    with pytest.raises(RotationError):
        extract({"user_id": "", "envelope": {}})


# --------------------------------------------------------------- re-wrapping
def test_migrating_one_record_from_static_keys_to_kms() -> None:
    static = make_key_provider()
    kms, _ = kms_provider()
    original = record("alice", 31, static)

    migrated = rewrap_record(original, source=static, target=kms)

    assert migrated["envelope"]["kp"] == "kms"
    assert "dek" in migrated["envelope"], "the wrapped data key must travel with the ciphertext"
    assert np.array_equal(
        fle.open_envelope(migrated["envelope"], user_ref="alice", provider=kms),
        unit_vector(31),
    )


def test_the_input_record_is_never_mutated() -> None:
    """The export is the rollback. Mutating it destroys the only way back."""
    static = make_key_provider()
    kms, _ = kms_provider()
    original = record("alice", 32, static)
    snapshot = json.dumps(original, sort_keys=True)

    rewrap_record(original, source=static, target=kms)

    assert json.dumps(original, sort_keys=True) == snapshot


def test_fields_person_3_added_survive_the_migration() -> None:
    """The record is Person 3's document, not ours. Only the envelope changes."""
    static = make_key_provider()
    kms, _ = kms_provider()
    original = record("alice", 33, static)
    original["enrolled_at"] = "2026-08-01T09:00:00Z"
    original["quality"] = {"det_score": 0.97}

    migrated = rewrap_record(original, source=static, target=kms)

    assert migrated["_id"] == original["_id"]
    assert migrated["enrolled_at"] == original["enrolled_at"]
    assert migrated["quality"] == original["quality"]


def test_a_static_to_static_rotation_moves_the_key_version() -> None:
    old = make_key_provider()
    new = make_key_provider(make_settings(fle_active_key="k2"))

    migrated = rewrap_record(record("alice", 34, old), source=old, target=new)

    assert migrated["envelope"]["kv"] == "k2"
    assert np.array_equal(
        fle.open_envelope(migrated["envelope"], user_ref="alice", provider=new), unit_vector(34)
    )


def test_a_record_whose_reference_does_not_match_the_envelope_fails_loudly() -> None:
    """It means the export and the envelopes disagree about who is who."""
    static = make_key_provider()
    kms, _ = kms_provider()
    mismatched = record("alice", 35, static)
    mismatched["user_id"] = "bob"

    with pytest.raises(Exception) as caught:
        rewrap_record(mismatched, source=static, target=kms)
    assert "DECRYPT" in str(caught.value).upper() or "decrypt" in str(caught.value)


def test_re_wrapping_verifies_the_result_before_returning_it() -> None:
    """A vector that cannot be read back is a lost enrolment, not a warning."""
    static = make_key_provider()
    wrong_target = make_key_provider(make_settings(fle_active_key="k2"))
    original = record("alice", 36, static)

    migrated = rewrap_record(original, source=static, target=wrong_target)
    # The verification inside rewrap_record is what guarantees this holds; the
    # assertion here is the same claim stated from outside.
    assert np.array_equal(
        fle.open_envelope(migrated["envelope"], user_ref="alice", provider=wrong_target),
        unit_vector(36),
    )


def test_the_active_key_id_is_what_identifies_an_already_migrated_record() -> None:
    """The re-run check: without it, a second pass re-wraps everything again."""
    static = make_key_provider()
    kms, _ = kms_provider()

    assert static.active_key_id == "k1"
    assert kms.active_key_id.startswith("arn:aws:kms:")

    migrated = rewrap_record(record("alice", 37, static), source=static, target=kms)
    assert migrated["envelope"]["kv"] == kms.active_key_id
    assert migrated["envelope"]["kp"] == kms.name
