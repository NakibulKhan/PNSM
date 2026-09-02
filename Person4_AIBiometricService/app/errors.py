"""Reason codes and the single error envelope used by every endpoint.

The reason code table is a *contract* with Person 1 (mobile) and Person 2
(dashboard): they localise user-facing messages from these codes and nothing
else.  Adding, renaming or removing a member of ``ReasonCode`` is a breaking
change and must be announced to the team.

Reference: blueprint section 03.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Final


class Decision(str, Enum):
    """Outcome of a verification attempt (blueprint section 04, three-band)."""

    APPROVED = "approved"
    FLAGGED = "flagged"
    REJECTED = "rejected"


class ReasonCode(str, Enum):
    """Every terminal outcome the AI service can produce.

    Keep this list and :data:`REASON_SPECS` in sync -- ``test_reason_codes``
    fails the build if they drift apart.
    """

    OK_MATCH = "OK_MATCH"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    NO_MATCH = "NO_MATCH"
    NO_FACE_DETECTED = "NO_FACE_DETECTED"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    IMAGE_TOO_BLURRY = "IMAGE_TOO_BLURRY"
    IMAGE_TOO_DARK = "IMAGE_TOO_DARK"
    FACE_TOO_SMALL = "FACE_TOO_SMALL"
    MOCK_LOCATION = "MOCK_LOCATION"
    EMULATOR_DETECTED = "EMULATOR_DETECTED"
    REPLAY_DETECTED = "REPLAY_DETECTED"
    STALE_CAPTURE = "STALE_CAPTURE"
    NO_REFERENCE_EMBEDDING = "NO_REFERENCE_EMBEDDING"
    DECRYPT_FAILED = "DECRYPT_FAILED"
    MODEL_VERSION_MISMATCH = "MODEL_VERSION_MISMATCH"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    RATE_LIMITED = "RATE_LIMITED"
    UPSTREAM_STORAGE_ERROR = "UPSTREAM_STORAGE_ERROR"
    INTERNAL = "INTERNAL"
    # Transport-level codes: not part of the check-in decision surface, but
    # returned by middleware before a request reaches a handler.
    UNAUTHORIZED = "UNAUTHORIZED"
    BAD_REQUEST = "BAD_REQUEST"


class ReasonSpec:
    """Static metadata attached to a reason code.

    ``message`` is deliberately written for an end user, not an operator: it
    says what happened and what to do next, with no apology and no internals.
    """

    __slots__ = ("decision", "http_status", "message", "retryable", "security_event")

    def __init__(
        self,
        http_status: int,
        decision: Decision | None,
        retryable: bool,
        message: str,
        security_event: bool = False,
    ) -> None:
        self.http_status = http_status
        self.decision = decision
        self.retryable = retryable
        self.message = message
        self.security_event = security_event


REASON_SPECS: Final[dict[ReasonCode, ReasonSpec]] = {
    ReasonCode.OK_MATCH: ReasonSpec(200, Decision.APPROVED, False, "Checked in."),
    ReasonCode.LOW_CONFIDENCE: ReasonSpec(
        200, Decision.FLAGGED, False, "Sent to HR for review. You are checked in pending approval."
    ),
    ReasonCode.NO_MATCH: ReasonSpec(
        200, Decision.REJECTED, True, "We could not match your face. Try again in better light."
    ),
    ReasonCode.NO_FACE_DETECTED: ReasonSpec(
        422, Decision.REJECTED, True, "No face in frame. Centre your face and retry."
    ),
    ReasonCode.MULTIPLE_FACES: ReasonSpec(
        422, Decision.REJECTED, True, "More than one face detected. Check in alone."
    ),
    ReasonCode.IMAGE_TOO_BLURRY: ReasonSpec(
        422, Decision.REJECTED, True, "Hold the phone steady and retry."
    ),
    ReasonCode.IMAGE_TOO_DARK: ReasonSpec(
        422, Decision.REJECTED, True, "Move somewhere brighter and retry."
    ),
    ReasonCode.FACE_TOO_SMALL: ReasonSpec(
        422, Decision.REJECTED, True, "Move closer to the camera."
    ),
    ReasonCode.MOCK_LOCATION: ReasonSpec(
        403, Decision.REJECTED, False, "Turn off mock location apps to check in.", security_event=True
    ),
    ReasonCode.EMULATOR_DETECTED: ReasonSpec(
        403, Decision.REJECTED, False, "Check in from a physical device.", security_event=True
    ),
    ReasonCode.REPLAY_DETECTED: ReasonSpec(
        409, Decision.REJECTED, False, "This photo was already used. Take a new one.", security_event=True
    ),
    ReasonCode.STALE_CAPTURE: ReasonSpec(
        409, Decision.REJECTED, True, "Photo expired. Retake and submit.", security_event=True
    ),
    ReasonCode.NO_REFERENCE_EMBEDDING: ReasonSpec(
        409, Decision.REJECTED, False, "Profile incomplete. Contact HR."
    ),
    ReasonCode.DECRYPT_FAILED: ReasonSpec(
        500, Decision.REJECTED, False, "Something went wrong. Contact HR.", security_event=True
    ),
    ReasonCode.MODEL_VERSION_MISMATCH: ReasonSpec(
        409, Decision.REJECTED, False, "Profile needs re-enrolment. Contact HR."
    ),
    ReasonCode.PAYLOAD_TOO_LARGE: ReasonSpec(
        413, Decision.REJECTED, True, "Photo too large. Retry."
    ),
    ReasonCode.RATE_LIMITED: ReasonSpec(
        429, Decision.REJECTED, True, "Too many attempts. Wait a moment."
    ),
    ReasonCode.UPSTREAM_STORAGE_ERROR: ReasonSpec(
        502, Decision.REJECTED, True, "Network issue. Retry."
    ),
    ReasonCode.INTERNAL: ReasonSpec(500, Decision.REJECTED, True, "Something went wrong. Retry."),
    ReasonCode.UNAUTHORIZED: ReasonSpec(401, None, False, "Request rejected.", security_event=True),
    ReasonCode.BAD_REQUEST: ReasonSpec(400, None, False, "Request could not be understood."),
}

#: Codes that describe a completed face comparison rather than a failure to
#: perform one.  These come back as HTTP 200 with a ``decision`` body.
DECISION_CODES: Final[frozenset[ReasonCode]] = frozenset(
    {ReasonCode.OK_MATCH, ReasonCode.LOW_CONFIDENCE, ReasonCode.NO_MATCH}
)


class PnsmError(Exception):
    """Any expected, enumerated failure.

    Handlers raise this; a single exception handler in :mod:`app.main` turns it
    into the error envelope.  Anything *not* raised as a ``PnsmError`` is a bug
    and is reported as :attr:`ReasonCode.INTERNAL` with no detail leaked.
    """

    def __init__(
        self,
        code: ReasonCode,
        *,
        detail: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.spec = REASON_SPECS[code]
        self.detail = detail
        self.extra = extra or {}
        super().__init__(f"{code.value}: {detail or self.spec.message}")

    @property
    def http_status(self) -> int:
        return self.spec.http_status

    def envelope(self, request_id: str | None = None) -> dict[str, Any]:
        """Render the wire format.

        ``detail`` is intentionally *not* included: it is for our logs, not for
        a caller who might be an attacker probing behaviour.
        """
        body: dict[str, Any] = {
            "error": {
                "code": self.code.value,
                "message": self.spec.message,
                "retryable": self.spec.retryable,
                "request_id": request_id,
            }
        }
        if self.extra:
            body["error"]["context"] = self.extra
        return body


def envelope_for(code: ReasonCode, request_id: str | None = None) -> dict[str, Any]:
    """Convenience wrapper for building an envelope without raising."""
    return PnsmError(code).envelope(request_id)
