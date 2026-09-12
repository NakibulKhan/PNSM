"""The reason-code table is a contract with Person 1 and Person 2.

They localise every user-facing message from these codes.  Adding, renaming or
removing one is a breaking change, and these tests are what make that visible
rather than silent.
"""

from __future__ import annotations

from app.errors import DECISION_CODES, REASON_SPECS, Decision, PnsmError, ReasonCode

#: Frozen snapshot of the published table (blueprint section 03) plus the two
#: transport-level codes. A diff here means the contract moved.
PUBLISHED = {
    "OK_MATCH": 200,
    "LOW_CONFIDENCE": 200,
    "NO_MATCH": 200,
    "NO_FACE_DETECTED": 422,
    "MULTIPLE_FACES": 422,
    "IMAGE_TOO_BLURRY": 422,
    "IMAGE_TOO_DARK": 422,
    "FACE_TOO_SMALL": 422,
    "MOCK_LOCATION": 403,
    "EMULATOR_DETECTED": 403,
    "REPLAY_DETECTED": 409,
    "STALE_CAPTURE": 409,
    "NO_REFERENCE_EMBEDDING": 409,
    "DECRYPT_FAILED": 500,
    "MODEL_VERSION_MISMATCH": 409,
    "PAYLOAD_TOO_LARGE": 413,
    "RATE_LIMITED": 429,
    "UPSTREAM_STORAGE_ERROR": 502,
    "INTERNAL": 500,
    "UNAUTHORIZED": 401,
    "BAD_REQUEST": 400,
}


def test_the_code_list_matches_the_published_contract() -> None:
    assert {code.value for code in ReasonCode} == set(PUBLISHED), (
        "The reason-code list changed. Update docs/API.md, tell Persons 1 and 2, "
        "then update PUBLISHED here."
    )


def test_every_status_matches_the_published_contract() -> None:
    for code in ReasonCode:
        assert REASON_SPECS[code].http_status == PUBLISHED[code.value], code.value


def test_every_code_has_a_spec() -> None:
    missing = [code for code in ReasonCode if code not in REASON_SPECS]
    assert not missing, f"codes without a spec: {missing}"


def test_every_message_is_written_for_an_end_user() -> None:
    for code, spec in REASON_SPECS.items():
        assert spec.message, code.value
        assert spec.message[0].isupper(), f"{code.value}: message should read as a sentence"
        assert spec.message.endswith((".", "!")), f"{code.value}: message should be punctuated"
        lowered = spec.message.lower()
        for leak in ("exception", "traceback", "null", "none", "stack", "sql", "onnx", "bcrypt"):
            assert leak not in lowered, f"{code.value} leaks internals: {spec.message}"


def test_no_message_apologises_or_hedges() -> None:
    for code, spec in REASON_SPECS.items():
        lowered = spec.message.lower()
        assert "sorry" not in lowered, code.value
        assert "oops" not in lowered, code.value


def test_decision_codes_are_exactly_the_two_hundreds() -> None:
    two_hundreds = {c for c in ReasonCode if REASON_SPECS[c].http_status == 200}
    assert two_hundreds == set(DECISION_CODES)


def test_decision_codes_map_onto_the_three_bands() -> None:
    assert REASON_SPECS[ReasonCode.OK_MATCH].decision is Decision.APPROVED
    assert REASON_SPECS[ReasonCode.LOW_CONFIDENCE].decision is Decision.FLAGGED
    assert REASON_SPECS[ReasonCode.NO_MATCH].decision is Decision.REJECTED


def test_security_events_are_flagged_for_alerting() -> None:
    expected = {
        ReasonCode.MOCK_LOCATION,
        ReasonCode.EMULATOR_DETECTED,
        ReasonCode.REPLAY_DETECTED,
        ReasonCode.STALE_CAPTURE,
        ReasonCode.DECRYPT_FAILED,
        ReasonCode.UNAUTHORIZED,
    }
    actual = {code for code, spec in REASON_SPECS.items() if spec.security_event}
    assert actual == expected


def test_retryable_is_set_sensibly() -> None:
    """A client must not retry something that will never succeed."""
    never_retryable = {
        ReasonCode.MOCK_LOCATION,
        ReasonCode.EMULATOR_DETECTED,
        ReasonCode.REPLAY_DETECTED,
        ReasonCode.NO_REFERENCE_EMBEDDING,
        ReasonCode.MODEL_VERSION_MISMATCH,
        ReasonCode.UNAUTHORIZED,
        ReasonCode.BAD_REQUEST,
    }
    for code in never_retryable:
        assert not REASON_SPECS[code].retryable, code.value
    for code in (ReasonCode.UPSTREAM_STORAGE_ERROR, ReasonCode.INTERNAL, ReasonCode.RATE_LIMITED):
        assert REASON_SPECS[code].retryable, code.value


def test_the_envelope_shape_is_identical_for_every_code() -> None:
    for code in ReasonCode:
        body = PnsmError(code).envelope("req-1")["error"]
        assert set(body) == {"code", "message", "retryable", "request_id"}
        assert body["code"] == code.value
        assert body["request_id"] == "req-1"


def test_internal_detail_never_reaches_the_wire() -> None:
    error = PnsmError(ReasonCode.DECRYPT_FAILED, detail="key k1 failed for user alice")
    body = error.envelope("req-1")["error"]
    assert "alice" not in str(body)
    assert "k1" not in str(body)
