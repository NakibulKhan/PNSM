"""HTTP-level behaviour: authentication, error envelopes, full check-in flow."""

from __future__ import annotations

import base64
import datetime as _dt

from tests.helpers import ULID_A, ULID_B, ULID_C, synthetic_jpeg


def _image(seed: int = 0) -> dict[str, str]:
    return {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(seed)).decode()}


def _now() -> str:
    return _dt.datetime.now(_dt.UTC).isoformat()


def enrol(client, user_ref: str = "alice", seed: int = 1) -> dict:
    response = client.post(
        "/v1/embed",
        {"user_ref": user_ref, "image": _image(seed), "request_id": ULID_A},
    )
    assert response.status_code == 200, response.text
    return response.json()["envelope"]


# ------------------------------------------------------------------- auth
def test_health_and_ready_need_no_signature(raw_client) -> None:
    """A cron monitor must reach these without credentials."""
    assert raw_client.get("/health").status_code == 200
    assert raw_client.get("/ready").status_code == 200


def test_health_does_not_touch_the_model(raw_client) -> None:
    body = raw_client.get("/health").json()
    assert set(body) == {"status", "version", "uptime_s"}
    assert body["status"] == "ok"


def test_an_unsigned_business_request_is_rejected(raw_client) -> None:
    response = raw_client.post(
        "/v1/embed", json={"user_ref": "alice", "image": _image(), "request_id": ULID_A}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_a_tampered_body_invalidates_the_signature(client) -> None:
    import json

    from app.crypto import hmac_auth

    payload = {"user_ref": "alice", "image": _image(), "request_id": ULID_A}
    body = json.dumps(payload).encode()
    timestamp = hmac_auth.current_timestamp()
    signature = hmac_auth.sign(base64.b64decode("BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ="), timestamp, body)

    response = client._client.post(
        "/v1/embed",
        content=json.dumps({**payload, "user_ref": "bob"}).encode(),
        headers={
            "Content-Type": "application/json",
            hmac_auth.TIMESTAMP_HEADER: timestamp,
            hmac_auth.SIGNATURE_HEADER: signature,
        },
    )
    assert response.status_code == 401


def test_admin_routes_need_the_admin_header(client) -> None:
    assert client.post("/v1/admin/recalibrate", {}).status_code == 401
    assert client.post("/v1/admin/recalibrate", {}, admin=True).status_code == 200


def test_metrics_needs_the_admin_header(client) -> None:
    assert client.get("/metrics").status_code == 401
    assert client.get("/metrics", admin=True).status_code == 200


def test_every_response_carries_a_request_id(raw_client) -> None:
    assert raw_client.get("/health").headers.get("x-request-id")


# ------------------------------------------------------------------ flow
def test_the_full_enrol_then_check_in_flow_approves(client) -> None:
    envelope = enrol(client, seed=3)
    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": _image(3),
            "envelope": envelope,
            "request_id": ULID_B,
            "captured_at": _now(),
            "device": {"platform": "android"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["decision"] == "approved"
    assert body["reason_code"] == "OK_MATCH"


def test_a_different_face_is_rejected_with_two_hundred(client) -> None:
    """A completed comparison is a decision, not an HTTP error."""
    envelope = enrol(client, seed=3)
    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": _image(77),
            "envelope": envelope,
            "request_id": ULID_B,
            "captured_at": _now(),
            "device": {"platform": "android"},
        },
    )
    assert response.status_code == 200
    assert response.json()["decision"] == "rejected"


# --------------------------------------------------------------- guards
def test_mock_location_returns_four_oh_three(client) -> None:
    envelope = enrol(client)
    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": _image(),
            "envelope": envelope,
            "request_id": ULID_B,
            "captured_at": _now(),
            "device": {"platform": "android", "is_mock_location": True},
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "MOCK_LOCATION"
    assert response.json()["error"]["retryable"] is False


def test_a_replayed_request_id_returns_four_oh_nine(client) -> None:
    envelope = enrol(client, seed=4)
    body = {
        "user_ref": "alice",
        "image": _image(4),
        "envelope": envelope,
        "request_id": ULID_B,
        "captured_at": _now(),
        "device": {"platform": "android"},
    }
    assert client.post("/v1/verify", body).status_code == 200
    repeat = client.post("/v1/verify", {**body, "image": _image(9)})
    assert repeat.status_code == 409
    assert repeat.json()["error"]["code"] == "REPLAY_DETECTED"


def test_a_stale_capture_returns_four_oh_nine(client) -> None:
    envelope = enrol(client)
    old = (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=2)).isoformat()
    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": _image(),
            "envelope": envelope,
            "request_id": ULID_C,
            "captured_at": old,
            "device": {"platform": "android"},
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STALE_CAPTURE"


# ------------------------------------------------------------ validation
def test_a_malformed_body_uses_our_envelope_not_fastapis(client) -> None:
    """One error shape means Persons 1 and 2 write one error path, not two."""
    response = client.post("/v1/embed", {"user_ref": "alice"})
    assert response.status_code == 400
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == "BAD_REQUEST"
    assert "detail" not in body


def test_unknown_fields_are_refused(client) -> None:
    response = client.post(
        "/v1/embed",
        {"user_ref": "alice", "image": _image(), "request_id": ULID_A, "is_admin": True},
    )
    assert response.status_code == 400


def test_an_invalid_user_ref_is_refused(client) -> None:
    response = client.post(
        "/v1/embed",
        {"user_ref": "alice/../bob", "image": _image(), "request_id": ULID_A},
    )
    assert response.status_code == 400


def test_an_unknown_route_returns_a_json_envelope(raw_client) -> None:
    response = raw_client.get("/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------- pin
def test_pin_hash_then_verify_over_http(client) -> None:
    record = client.post("/v1/security/pin/hash", {"user_ref": "alice", "pin": "418362"})
    assert record.status_code == 200, record.text
    stored = record.json()["pin_hash"]

    good = client.post(
        "/v1/security/pin/verify",
        {"user_ref": "alice", "pin": "418362", "pin_hash": stored},
    )
    assert good.json()["match"] is True

    bad = client.post(
        "/v1/security/pin/verify",
        {"user_ref": "alice", "pin": "999111", "pin_hash": stored},
    )
    assert bad.status_code == 200
    assert bad.json()["match"] is False
    assert bad.json()["attempts_left"] < 5


def test_a_weak_pin_is_refused_with_guidance(client) -> None:
    response = client.post("/v1/security/pin/hash", {"user_ref": "alice", "pin": "123456"})
    assert response.status_code == 400


# ------------------------------------------------------------- storage
def test_presign_put_builds_the_key_server_side(client) -> None:
    response = client.post(
        "/v1/storage/presign-put",
        {
            "user_ref": "alice",
            "purpose": "checkin",
            "object_id": ULID_A,
            "content_type": "image/webp",
            "content_length": 150_000,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["object_key"].startswith("checkins/")
    assert body["method"] == "PUT"


def test_presign_put_refuses_an_oversized_upload(client) -> None:
    response = client.post(
        "/v1/storage/presign-put",
        {
            "user_ref": "alice",
            "purpose": "checkin",
            "object_id": ULID_A,
            "content_type": "image/webp",
            "content_length": 4_000_000,
        },
    )
    assert response.status_code == 413


def test_presign_get_refuses_traversal(client) -> None:
    response = client.post("/v1/storage/presign-get", {"object_key": "refs/../../etc/passwd"})
    assert response.status_code == 400
