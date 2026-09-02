"""The deployment manifests are code, and are tested like code.

An IAM policy with a stray wildcard, a task definition with a secret in
``environment``, a CloudFront distribution that rewrites only 404 and not 403 --
none of these fail at deploy time.  They all apply cleanly and are wrong later,
in production, quietly.  These tests are the only place that mistake is caught
before it costs an afternoon.

Reference: master plan, Quadrant IV (AWS multi-stage Dockerization, edge
routing, OWASP A01/A02/A03).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.provision_aws import (
    DEFERRED,
    TEMPLATES,
    ProvisionError,
    Topology,
    check,
    placeholders_in,
    render,
    render_template,
    strip_comments,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY = REPO_ROOT / "deploy"
IAM = DEPLOY / "iam"


def load(name: str) -> dict:
    """Read a manifest, unwrapping the CLI envelope where the API requires one.

    `create-distribution` takes {"DistributionConfig": {...}} and
    `create-response-headers-policy` takes {"ResponseHeadersPolicyConfig": {...}},
    while IAM and ECS take their fields at the top level. Unwrapping here keeps
    every assertion below written against the thing being configured.
    """
    doc = json.loads((DEPLOY / name).read_text(encoding="utf-8"))
    for wrapper in ("DistributionConfig", "ResponseHeadersPolicyConfig"):
        if wrapper in doc:
            return doc[wrapper]
    return doc


def statements(policy: dict) -> list[dict]:
    raw = policy["Statement"]
    return raw if isinstance(raw, list) else [raw]


def as_list(value: object) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def complete_topology() -> Topology:
    topo = Topology(
        account_id="000000000000",
        region="ap-southeast-1",
        selfie_bucket="pnsm-selfies",
        web_bucket="pnsm-web",
        github_org="pnsm-group8",
        github_repo="pnsm",
    )
    topo.extra["CLOUDFRONT_DOMAIN"] = "d111111abcdef8.cloudfront.net"
    return topo


# ------------------------------------------------------------------ shapes
def test_every_template_is_valid_json() -> None:
    for name in TEMPLATES:
        path = DEPLOY / name
        assert path.exists(), f"{name} is referenced by provision_aws.py but does not exist"
        json.loads(path.read_text(encoding="utf-8"))


def test_every_placeholder_is_one_the_provisioner_knows_about() -> None:
    """An unknown placeholder renders as literal '<REGION>' into a real resource."""
    known = set(complete_topology().values()) | DEFERRED
    for name in TEMPLATES:
        found = placeholders_in((DEPLOY / name).read_text(encoding="utf-8"))
        unknown = found - known
        assert not unknown, f"{name} uses placeholders nothing fills: {sorted(unknown)}"


def test_the_provisioner_resolves_every_blocking_placeholder() -> None:
    assert check(complete_topology().values()) == {}


def test_an_incomplete_topology_is_reported_rather_than_rendered() -> None:
    problems = check({"REGION": "ap-southeast-1"})
    assert problems, "a topology with no account id must not render clean"
    assert any("ACCOUNT_ID" in names for names in problems.values())


def test_comments_are_stripped_before_aws_sees_them() -> None:
    """IAM rejects unknown keys; the reasoning must not reach the API."""
    for name in TEMPLATES:
        rendered, _ = render_template(DEPLOY / name, complete_topology().values())
        assert "_comment" not in rendered, f"{name} still carries a _comment key after rendering"
        json.loads(rendered)


def test_rendering_leaves_placeholders_it_has_no_value_for() -> None:
    """Silently blanking one would produce a resource named after nothing."""
    assert render("<REGION> and <KMS_KEY_ARN>", {"REGION": "ap-southeast-1"}) == (
        "ap-southeast-1 and <KMS_KEY_ARN>"
    )


def test_the_placeholder_pattern_does_not_match_ordinary_prose() -> None:
    """A greedy pattern would eat a comparison operator or an XML fragment."""
    assert placeholders_in("a < b and b > c") == set()
    assert placeholders_in("<p>markup</p>") == set()
    assert placeholders_in("<AB>") == set(), "two letters is too short to be a placeholder"
    assert placeholders_in("<KMS_KEY_ARN>") == {"KMS_KEY_ARN"}


def test_stripping_comments_preserves_everything_else() -> None:
    node = {"_comment": "why", "_comment_x": ["a"], "Keep": [{"_comment": 1, "Ok": 2}]}
    assert strip_comments(node) == {"Keep": [{"Ok": 2}]}


# -------------------------------------------------------------- topology
@pytest.mark.parametrize(
    "field,value",
    [
        ("account_id", "12345"),
        ("account_id", "notanaccount"),
        ("region", "singapore"),
        ("selfie_bucket", "PNSM_Selfies"),
        ("web_bucket", "x"),
    ],
)
def test_a_malformed_topology_value_is_refused(field: str, value: str) -> None:
    topo = complete_topology()
    setattr(topo, field, value)
    with pytest.raises(ProvisionError):
        topo.validate()


def test_a_well_formed_topology_passes() -> None:
    complete_topology().validate()


# ------------------------------------------------------- ecs task definition
def test_the_task_runs_as_a_non_root_user_on_a_read_only_filesystem() -> None:
    container = load("ecs-task-definition.json")["containerDefinitions"][0]
    assert container["user"] == "10001"
    assert container["readonlyRootFilesystem"] is True
    assert container["privileged"] is False
    assert container["linuxParameters"]["capabilities"]["drop"] == ["ALL"]


def test_the_read_only_filesystem_still_has_somewhere_to_write() -> None:
    """Python's tempfile and ONNX Runtime both need /tmp; without it, no boot."""
    task = load("ecs-task-definition.json")
    container = task["containerDefinitions"][0]
    mounts = {m["containerPath"] for m in container["mountPoints"]}
    assert "/tmp" in mounts  # noqa: S108 - a container mount path, not a temp file
    assert {v["name"] for v in task["volumes"]} >= {"tmp"}


def test_fargate_unsupported_fields_are_absent() -> None:
    """linuxParameters.tmpfs is EC2-only; a task definition using it is rejected."""
    task = load("ecs-task-definition.json")
    assert task["requiresCompatibilities"] == ["FARGATE"]
    assert task["networkMode"] == "awsvpc"
    for container in task["containerDefinitions"]:
        assert "tmpfs" not in container.get("linuxParameters", {})
        assert "devices" not in container.get("linuxParameters", {})


def test_no_secret_is_passed_through_the_environment_block() -> None:
    """`environment` is readable by anyone with ecs:DescribeTaskDefinition."""
    container = load("ecs-task-definition.json")["containerDefinitions"][0]
    env_names = {e["name"] for e in container["environment"]}
    secret_names = {s["name"] for s in container["secrets"]}

    must_be_secret = {
        "PNSM_HMAC_SECRET",
        "PNSM_PIN_PEPPER",
        "PNSM_ADMIN_TOKEN",
        "PNSM_FLE_KEYS",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_ACCESS_KEY_ID",
    }
    assert not (env_names & must_be_secret), f"secret in plain environment: {env_names & must_be_secret}"
    assert must_be_secret - {"AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID"} <= secret_names

    for entry in container["secrets"]:
        assert entry["valueFrom"].startswith("arn:aws:secretsmanager:")


def test_the_deployed_task_uses_kms_not_a_static_key() -> None:
    """The master plan's requirement, asserted where it is actually configured."""
    container = load("ecs-task-definition.json")["containerDefinitions"][0]
    env = {e["name"]: e["value"] for e in container["environment"]}
    assert env["PNSM_KEY_PROVIDER"] == "kms"
    assert env["PNSM_KMS_KEY_ID"], "kms provider with no CMK placeholder"
    assert env["PNSM_APP_ENV"] == "production"
    assert env["PNSM_AUTH_REQUIRED"] == "true"
    assert env["PNSM_SECURITY_HEADERS"] == "true"
    assert env["PNSM_S3_SSE_KMS_KEY_ID"], "selfies would fall back to SSE-S3"


def test_the_health_check_allows_for_a_cold_model_load() -> None:
    """Too short a start period kills a task that was about to become healthy."""
    container = load("ecs-task-definition.json")["containerDefinitions"][0]
    health = container["healthCheck"]
    assert health["startPeriod"] >= 60
    assert "/health" in health["command"][-1]
    assert "/ready" not in health["command"][-1], "the readiness probe touches the model"


def test_the_task_has_enough_memory_for_two_onnx_sessions() -> None:
    task = load("ecs-task-definition.json")
    assert int(task["memory"]) >= 1024
    assert int(task["cpu"]) >= 512


def test_execution_and_task_roles_are_different_identities() -> None:
    """One role for both would hand the container the secret store."""
    task = load("ecs-task-definition.json")
    assert task["executionRoleArn"] != task["taskRoleArn"]


# ------------------------------------------------------------------- iam
IAM_POLICIES = [
    "iam/ai-svc-task-role-policy.json",
    "iam/ecs-execution-role-policy.json",
    "iam/github-actions-deploy-policy.json",
    "iam/kms-key-policy.json",
    "iam/selfie-bucket-policy.json",
]


@pytest.mark.parametrize("name", IAM_POLICIES)
def test_no_policy_grants_star_on_star(name: str) -> None:
    """Action '*' on Resource '*' is administrator access by another name."""
    for statement in statements(load(name)):
        if statement["Effect"] != "Allow":
            continue
        actions = as_list(statement.get("Action"))
        resources = as_list(statement.get("Resource"))
        if "*" in actions and "*" in resources:
            # The KMS key policy's root statement is the documented exception:
            # without it the key becomes unmanageable and unrecoverable.
            assert statement.get("Sid") == "EnableIamPoliciesForThisAccount", (
                f"{name}: statement {statement.get('Sid')} grants * on *"
            )


def test_the_task_role_cannot_encrypt_directly_with_the_cmk() -> None:
    """Envelope encryption means the CMK only ever wraps data keys."""
    for statement in statements(load("iam/ai-svc-task-role-policy.json")):
        if statement["Effect"] != "Allow":
            continue
        assert "kms:Encrypt" not in as_list(statement.get("Action"))
        assert "kms:*" not in as_list(statement.get("Action"))


def test_the_granted_prefixes_are_the_ones_the_code_actually_builds() -> None:
    """A prefix the policy grants but the code never writes is an AccessDenied
    on every enrolment -- in production, with nothing wrong in either file when
    read alone. This is the only place the two are compared."""
    from app.storage.keys import CHECKIN_PREFIX, REF_PREFIX

    policy = load("iam/ai-svc-task-role-policy.json")
    objects = next(s for s in statements(policy) if s.get("Sid") == "ReadAndPresignSelfieObjects")
    granted = {r.rsplit("/", 2)[-2] for r in as_list(objects["Resource"])}
    assert granted == {REF_PREFIX, CHECKIN_PREFIX}, (
        f"the task role grants {sorted(granted)} but app/storage/keys.py builds "
        f"{sorted({REF_PREFIX, CHECKIN_PREFIX})}"
    )


def test_the_lifecycle_rule_expires_the_prefix_the_code_writes() -> None:
    """A rule filtered on a prefix nothing uses deletes nothing, silently, for
    ninety days -- and the retention promise in SECURITY.md quietly stops being
    true."""
    from app.storage.keys import CHECKIN_PREFIX, REF_PREFIX
    from scripts.provision_aws import SELFIE_LIFECYCLE

    filtered = {rule["Filter"]["Prefix"].rstrip("/") for rule in SELFIE_LIFECYCLE["Rules"]}
    assert filtered == {REF_PREFIX, CHECKIN_PREFIX}

    expiring = [r for r in SELFIE_LIFECYCLE["Rules"] if "Expiration" in r]
    assert len(expiring) == 1, "only check-in selfies expire on a timer"
    assert expiring[0]["Filter"]["Prefix"].rstrip("/") == CHECKIN_PREFIX
    assert expiring[0]["Expiration"]["Days"] == 90


def test_the_task_role_cannot_delete_a_selfie() -> None:
    """Retention is a lifecycle rule, so a compromised container cannot erase evidence."""
    for statement in statements(load("iam/ai-svc-task-role-policy.json")):
        if statement["Effect"] != "Allow":
            continue
        actions = as_list(statement.get("Action"))
        assert "s3:DeleteObject" not in actions
        assert "s3:DeleteObjectVersion" not in actions
        assert "s3:*" not in actions


def test_the_embedding_key_grant_is_bound_to_an_encryption_context() -> None:
    """Without it, a stolen wrapped key could be redeemed for any employee."""
    policy = load("iam/ai-svc-task-role-policy.json")
    embedding = [
        s for s in statements(policy) if s.get("Sid") == "UnwrapAndMintDataKeysForBiometricEmbeddings"
    ]
    assert len(embedding) == 1
    condition = embedding[0]["Condition"]["StringEquals"]
    assert condition["kms:EncryptionContext:purpose"] == "pnsm-face-embedding"


def test_the_encryption_context_matches_what_the_code_actually_sends() -> None:
    """A policy and an implementation that disagree fail with an opaque AccessDenied."""
    from app.crypto.fle import KMS_PURPOSE, build_encryption_context

    policy = load("iam/ai-svc-task-role-policy.json")
    embedding = next(
        s for s in statements(policy) if s.get("Sid") == "UnwrapAndMintDataKeysForBiometricEmbeddings"
    )
    expected = embedding["Condition"]["StringEquals"]["kms:EncryptionContext:purpose"]
    assert expected == KMS_PURPOSE
    assert build_encryption_context("alice", "m1")["purpose"] == expected


def test_the_s3_side_kms_grant_is_scoped_to_s3() -> None:
    """It cannot carry the purpose condition, so it is bound by via-service instead."""
    policy = load("iam/ai-svc-task-role-policy.json")
    sse = next(s for s in statements(policy) if s.get("Sid") == "ServerSideEncryptSelfiesAtRest")
    assert sse["Condition"]["StringEquals"]["kms:ViaService"].startswith("s3.")


def test_plaintext_transport_is_denied_outright() -> None:
    task_role = load("iam/ai-svc-task-role-policy.json")
    denies = [s for s in statements(task_role) if s["Effect"] == "Deny"]
    assert any(
        s.get("Condition", {}).get("Bool", {}).get("aws:SecureTransport") == "false" for s in denies
    )


def test_the_bucket_policy_is_all_denies() -> None:
    """It exists to make mistakes impossible, not to grant anything."""
    for statement in statements(load("iam/selfie-bucket-policy.json")):
        assert statement["Effect"] == "Deny"


def test_the_bucket_refuses_anything_below_tls_1_2() -> None:
    """aws:SecureTransport alone is satisfied by TLS 1.0."""
    conditions = [s.get("Condition", {}) for s in statements(load("iam/selfie-bucket-policy.json"))]
    assert any(c.get("NumericLessThan", {}).get("s3:TlsVersion") == "1.2" for c in conditions)


def test_the_bucket_refuses_uploads_that_are_not_sse_kms() -> None:
    conditions = [s.get("Condition", {}) for s in statements(load("iam/selfie-bucket-policy.json"))]
    assert any(
        c.get("StringNotEquals", {}).get("s3:x-amz-server-side-encryption") == "aws:kms"
        for c in conditions
    )


def test_the_account_root_is_never_locked_out_of_the_bucket() -> None:
    """A NotPrincipal deny without root is unrecoverable without AWS support."""
    containment = next(
        s for s in statements(load("iam/selfie-bucket-policy.json")) if "NotPrincipal" in s
    )
    principals = as_list(containment["NotPrincipal"]["AWS"])
    assert any(p.endswith(":root") for p in principals)


def test_the_deploy_role_cannot_read_a_secret_or_decrypt_an_employee() -> None:
    policy = load("iam/github-actions-deploy-policy.json")
    denied: set[str] = set()
    for statement in statements(policy):
        if statement["Effect"] == "Deny":
            denied |= set(as_list(statement.get("Action")))
    assert {"kms:Decrypt", "secretsmanager:GetSecretValue"} <= denied
    assert {"iam:CreateRole", "iam:PutRolePolicy"} <= denied


def test_pass_role_is_scoped_to_named_roles_and_to_ecs() -> None:
    """Unscoped iam:PassRole turns a deploy role into an administrator."""
    policy = load("iam/github-actions-deploy-policy.json")
    pass_role = [s for s in statements(policy) if "iam:PassRole" in as_list(s.get("Action"))]
    assert len(pass_role) == 1
    statement = pass_role[0]
    assert "*" not in as_list(statement["Resource"])
    assert statement["Condition"]["StringEquals"]["iam:PassedToService"] == "ecs-tasks.amazonaws.com"


def test_the_oidc_trust_checks_both_audience_and_subject() -> None:
    """Without the audience check, any GitHub Actions run on earth can assume it."""
    trust = load("iam/github-actions-deploy-role.json")
    statement = statements(trust)[0]
    assert statement["Action"] == "sts:AssumeRoleWithWebIdentity"
    condition = statement["Condition"]
    assert condition["StringEquals"]["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    subjects = as_list(condition["StringLike"]["token.actions.githubusercontent.com:sub"])
    assert subjects, "no subject restriction"
    for subject in subjects:
        assert not subject.endswith(":*"), f"{subject} would let a fork's pull request deploy"


def test_the_kms_administrator_cannot_decrypt() -> None:
    """Managing the key and reading employees' faces are different jobs."""
    policy = load("iam/kms-key-policy.json")
    admin = next(s for s in statements(policy) if s.get("Sid") == "KeyAdministratorsCannotReadData")
    actions = as_list(admin["Action"])
    assert "kms:Decrypt" not in actions
    assert "kms:GenerateDataKey" not in actions
    assert "kms:*" not in actions


def test_scheduling_the_biometric_key_for_deletion_requires_mfa() -> None:
    policy = load("iam/kms-key-policy.json")
    guard = next(s for s in statements(policy) if s["Effect"] == "Deny")
    assert "kms:ScheduleKeyDeletion" in as_list(guard["Action"])
    assert guard["Condition"]["BoolIfExists"]["aws:MultiFactorAuthPresent"] == "false"


# ------------------------------------------------------------- cloudfront
def test_the_spa_rewrite_covers_403_as_well_as_404() -> None:
    """A private OAC bucket returns 403, not 404. Handling only 404 fails in production."""
    distribution = load("cloudfront-distribution.json")
    errors = {item["ErrorCode"]: item for item in distribution["CustomErrorResponses"]["Items"]}
    assert {403, 404} <= set(errors), "deep links will break for one of the two codes"
    for code in (403, 404):
        assert errors[code]["ResponsePagePath"] == "/index.html"
        assert errors[code]["ResponseCode"] == "200"
    assert distribution["CustomErrorResponses"]["Quantity"] == len(errors)


def test_server_errors_are_not_rewritten_into_a_success() -> None:
    """Turning a 502 into a 200 hides an outage from every status-code monitor."""
    distribution = load("cloudfront-distribution.json")
    codes = {item["ErrorCode"] for item in distribution["CustomErrorResponses"]["Items"]}
    assert not any(code >= 500 for code in codes)


def test_viewers_are_forced_onto_https_at_tls_1_2_or_better() -> None:
    distribution = load("cloudfront-distribution.json")
    assert distribution["DefaultCacheBehavior"]["ViewerProtocolPolicy"] == "redirect-to-https"
    assert distribution["ViewerCertificate"]["MinimumProtocolVersion"] == "TLSv1.2_2021"


def test_the_origin_is_private_and_read_through_origin_access_control() -> None:
    origin = load("cloudfront-distribution.json")["Origins"]["Items"][0]
    assert origin["OriginAccessControlId"], "a website-endpoint origin would need a public bucket"
    assert origin["S3OriginConfig"]["OriginAccessIdentity"] == ""


def test_the_distribution_only_serves_reads() -> None:
    behavior = load("cloudfront-distribution.json")["DefaultCacheBehavior"]
    assert set(behavior["AllowedMethods"]["Items"]) == {"GET", "HEAD"}


def test_the_selfie_bucket_is_not_behind_the_cdn() -> None:
    """Biometric images must not be cached at 400 edge locations. D-14."""
    for origin in load("cloudfront-distribution.json")["Origins"]["Items"]:
        assert "SELFIE" not in origin["DomainName"].upper()


def test_the_cloudfront_manifests_carry_the_wrapper_their_api_requires() -> None:
    """A flat file is rejected with a message naming a missing parameter, not a
    missing wrapper -- which sends you looking in the wrong place entirely."""
    for name, wrapper in (
        ("cloudfront-distribution.json", "DistributionConfig"),
        ("cloudfront-response-headers-policy.json", "ResponseHeadersPolicyConfig"),
    ):
        doc = json.loads((DEPLOY / name).read_text(encoding="utf-8"))
        assert wrapper in doc, f"{name} must wrap its config in {wrapper}"
        assert set(doc) <= {wrapper, "_comment"}, f"{name} has fields outside {wrapper}"

    # ECS and IAM take their fields at the top level. Wrapping those would be
    # just as wrong, so the absence is asserted too.
    for name in ("ecs-task-definition.json", "iam/kms-key-policy.json"):
        doc = json.loads((DEPLOY / name).read_text(encoding="utf-8"))
        assert "DistributionConfig" not in doc


def test_the_response_headers_policy_sets_the_headers_the_plan_names() -> None:
    policy = load("cloudfront-response-headers-policy.json")["SecurityHeadersConfig"]
    assert policy["FrameOptions"]["FrameOption"] == "DENY"
    assert policy["ContentTypeOptions"]["Override"] is True
    assert policy["StrictTransportSecurity"]["AccessControlMaxAgeSec"] >= 31_536_000
    csp = policy["ContentSecurityPolicy"]["ContentSecurityPolicy"]
    assert csp.startswith("default-src 'self'")
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp


def test_the_legacy_xss_auditor_is_explicitly_disabled() -> None:
    """X-XSS-Protection: 1 re-enables a removed feature that had its own bugs."""
    xss = load("cloudfront-response-headers-policy.json")["SecurityHeadersConfig"]["XSSProtection"]
    assert xss["Protection"] is False


# ------------------------------------------------------- frontend dockerfile
def dockerfile() -> str:
    return (DEPLOY / "frontend.Dockerfile").read_text(encoding="utf-8")


def test_the_builder_uses_node_24_slim_not_alpine() -> None:
    """Alpine's musl libc silently breaks native addon builds. Master plan."""
    text = dockerfile()
    assert "FROM node:24-slim AS builder" in text
    assert "FROM node:24-alpine" not in text


def test_the_runtime_stage_discards_the_node_runtime() -> None:
    """Under 50 MB is only reachable if nothing but static files survives."""
    text = dockerfile()
    assert "FROM nginx:alpine" in text
    assert "COPY --from=builder /src/dist" in text
    assert "COPY --from=builder /src/node_modules" not in text


def test_dependencies_are_installed_deterministically() -> None:
    """`npm install` is free to pull a patch nobody reviewed. OWASP A03."""
    text = dockerfile()
    assert "npm ci" in text
    assert "RUN npm install" not in text


def test_the_image_audits_its_own_dependency_tree() -> None:
    assert "npm audit" in dockerfile()


def test_the_frontend_container_does_not_run_as_root() -> None:
    text = dockerfile()
    assert "USER nginx" in text
    assert "EXPOSE 8080" in text, "binding 80 would require the master process to be root"


def test_no_secret_is_baked_into_the_bundle() -> None:
    """Every VITE_* value is inlined into public JavaScript at build time."""
    text = dockerfile()
    for forbidden in ("VITE_JWT", "VITE_SECRET", "VITE_AWS", "VITE_MONGO", "SECRET_KEY"):
        assert forbidden not in text, f"{forbidden} would be readable in the shipped bundle"


def test_the_rendered_nginx_config_is_parsed_at_build_time() -> None:
    """A broken config must fail the build, not the first request."""
    assert "nginx -t" in dockerfile()
