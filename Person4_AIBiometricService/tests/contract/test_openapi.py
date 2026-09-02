"""The published contract.

Person 1, Person 2 and Person 3 code against ``docs/openapi.json``.  These
tests validate real responses against the schema the service actually
generates, so the document and the behaviour cannot drift apart in either
direction.
"""

from __future__ import annotations

import base64
import datetime as _dt

import jsonschema
import pytest

from tests.helpers import ULID_A, ULID_B, synthetic_jpeg

REQUIRED_PATHS = {
    "/health",
    "/ready",
    "/metrics",
    "/v1/embed",
    "/v1/verify",
    "/v1/security/pin/hash",
    "/v1/security/pin/verify",
    "/v1/storage/presign-put",
    "/v1/storage/presign-get",
    "/v1/admin/recalibrate",
    "/v1/admin/warmup",
}


def _schema_for(spec: dict, path: str, status: str = "200") -> dict:
    """Build a standalone JSON Schema for one path's response.

    The response schema is usually a bare ``{"$ref": ...}``. It is wrapped in
    ``allOf`` rather than merged with ``$defs`` as a sibling key: in drafts
    before 2020-12 a ``$ref`` sibling is *ignored*, so a merged form would
    silently validate against nothing at all if the dialect were ever inferred
    differently. ``allOf`` means the same thing in every draft.
    """
    import json

    operation = spec["paths"][path]["post" if "post" in spec["paths"][path] else "get"]
    response = operation["responses"][status]["content"]["application/json"]["schema"]
    definitions = spec.get("components", {}).get("schemas", {})

    # OpenAPI puts shared schemas under #/components/schemas; JSON Schema wants
    # them under #/$defs.
    rewritten = json.loads(
        json.dumps({"schema": response, "defs": definitions}).replace(
            "#/components/schemas/", "#/$defs/"
        )
    )
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": rewritten["defs"],
        "allOf": [rewritten["schema"]],
    }


def validate(spec: dict, path: str, payload: dict, status: str = "200") -> None:
    jsonschema.validate(payload, _schema_for(spec, path, status))


def test_the_schema_helper_actually_rejects_a_bad_payload() -> None:
    """Guards the guard.

    A validator that silently accepts everything is worse than no validator,
    and that is exactly what a mishandled ``$ref`` produces.
    """
    spec = {
        "paths": {"/x": {"get": {"responses": {"200": {"content": {"application/json": {
            "schema": {"$ref": "#/components/schemas/Thing"}}}}}}}},
        "components": {"schemas": {"Thing": {
            "type": "object",
            "properties": {"n": {"type": "integer"}},
            "required": ["n"],
        }}},
    }
    validate(spec, "/x", {"n": 1})
    with pytest.raises(jsonschema.ValidationError):
        validate(spec, "/x", {"n": "not an integer"})
    with pytest.raises(jsonschema.ValidationError):
        validate(spec, "/x", {})


@pytest.fixture()
def spec(app):
    return app.openapi()


def test_every_documented_path_exists(spec) -> None:
    assert set(spec["paths"]) >= REQUIRED_PATHS, REQUIRED_PATHS - set(spec["paths"])


def test_the_document_is_valid_openapi(spec) -> None:
    assert spec["openapi"].startswith("3.")
    assert spec["info"]["title"]
    assert spec["info"]["version"]


def test_health_response_matches_its_schema(client, spec) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    validate(spec, "/health", response.json())


def test_ready_response_matches_its_schema(client, spec) -> None:
    response = client.get("/ready")
    assert response.status_code == 200
    validate(spec, "/ready", response.json())


def test_embed_response_matches_its_schema(client, spec) -> None:
    response = client.post(
        "/v1/embed",
        {
            "user_ref": "alice",
            "image": {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(1)).decode()},
            "request_id": ULID_A,
        },
    )
    assert response.status_code == 200, response.text
    validate(spec, "/v1/embed", response.json())


def test_verify_response_matches_its_schema(client, spec) -> None:
    enrolled = client.post(
        "/v1/embed",
        {
            "user_ref": "alice",
            "image": {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(2)).decode()},
            "request_id": ULID_A,
        },
    ).json()

    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(2)).decode()},
            "envelope": enrolled["envelope"],
            "request_id": ULID_B,
            "captured_at": _dt.datetime.now(_dt.UTC).isoformat(),
            "device": {"platform": "android", "is_mock_location": False},
        },
    )
    assert response.status_code == 200, response.text
    validate(spec, "/v1/verify", response.json())


def test_error_responses_match_the_documented_envelope(client, spec) -> None:
    response = client.post(
        "/v1/verify",
        {
            "user_ref": "alice",
            "image": {"kind": "base64", "value": "AAAA"},
            "envelope": {
                "v": 1, "kv": "k1", "alg": "AES-256-GCM",
                "iv": "AAAAAAAAAAAAAAAA", "ct": "AAAA", "tag": "AAAAAAAAAAAAAAAAAAAAAA==",
                "model_version": "stub_v1",
            },
            "request_id": ULID_A,
            "captured_at": _dt.datetime.now(_dt.UTC).isoformat(),
            "device": {"platform": "android", "is_mock_location": True},
        },
    )
    assert response.status_code == 403
    validate(spec, "/v1/verify", response.json(), status="403")


def test_the_reason_code_table_is_documented(spec) -> None:
    """Every status a client must branch on appears in the document."""
    verify = spec["paths"]["/v1/verify"]["post"]["responses"]
    for status in ("400", "401", "403", "409", "413", "422", "429", "500", "502"):
        assert status in verify, f"status {status} is undocumented on /v1/verify"


def test_request_bodies_forbid_unknown_fields(spec) -> None:
    """A silently ignored typo is how a security flag ends up never read."""
    schemas = spec["components"]["schemas"]
    for name in ("VerifyRequest", "EmbedRequest", "DeviceModel"):
        assert schemas[name].get("additionalProperties") is False, name
