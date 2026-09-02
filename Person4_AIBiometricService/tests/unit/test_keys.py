"""Object key construction and traversal defence."""

from __future__ import annotations

import datetime as _dt

import pytest

from app.errors import PnsmError, ReasonCode
from app.storage import keys as K
from tests.helpers import ULID_A


def test_checkin_keys_are_date_partitioned() -> None:
    when = _dt.datetime(2026, 9, 14, 9, 2, 41, tzinfo=_dt.UTC)
    key = K.checkin_key("alice", ULID_A, "image/webp", when=when)
    assert key == f"checkins/2026/09/14/alice/{ULID_A}.webp"


def test_reference_keys_sit_under_their_own_prefix() -> None:
    assert K.reference_key("alice", ULID_A, "image/jpeg") == f"refs/alice/{ULID_A}.jpg"


def test_only_allowlisted_content_types_are_accepted() -> None:
    for content_type in ("image/png", "image/gif", "application/pdf", "text/html"):
        with pytest.raises(PnsmError) as caught:
            K.reference_key("alice", ULID_A, content_type)
        assert caught.value.code is ReasonCode.BAD_REQUEST


def test_user_refs_are_bounded() -> None:
    for bad in ("", "a" * 65, "alice/../bob", "alice bob", "alice;drop", "../etc"):
        with pytest.raises(PnsmError):
            K.validate_user_ref(bad)


def test_object_ids_must_be_ulids() -> None:
    for bad in ("", "abc", "01JB7ZQ2K8N4V0X6M3PYE9TSR", "01jb7zq2k8n4v0x6m3pye9tsra"):
        with pytest.raises(PnsmError):
            K.validate_ulid(bad)


def test_traversal_and_absolute_paths_are_refused() -> None:
    hostile = [
        "refs/../../etc/passwd",
        "/refs/alice/x.jpg",
        "refs//alice/x.jpg",
        "refs\\alice\\x.jpg",
        "..",
        "checkins/../../secrets",
        "s3://bucket/key",
        "",
    ]
    for key in hostile:
        assert not K.is_managed_key(key), key
        with pytest.raises(PnsmError):
            K.require_managed_key(key)


def test_keys_outside_a_managed_prefix_are_refused() -> None:
    assert not K.is_managed_key("backups/dump.sql")
    assert not K.is_managed_key("alice/x.jpg")


def test_generated_keys_pass_their_own_validator() -> None:
    """The producer and the validator must agree, or reads break in production."""
    assert K.is_managed_key(K.reference_key("alice", ULID_A, "image/webp"))
    assert K.is_managed_key(K.checkin_key("alice", ULID_A, "image/jpeg"))


def test_overlong_keys_are_refused() -> None:
    assert not K.is_managed_key("refs/" + "a" * 600)
