#!/usr/bin/env python3
"""Render and apply the AWS topology for the PNSM system.

Every file under ``deploy/`` is a template with ``<ANGLE_BRACKET>`` placeholders.
This script fills them in from one small set of values and, optionally, applies
the result.  Two reasons it exists rather than a page of README commands:

1.  The master plan puts a hard deadline on Person 4 -- "provision the AWS S3
    IAM credentials, the AWS CloudFront distributions, and the MongoDB Atlas
    connection strings within the first week" -- because three other people are
    blocked until those exist.  A script does that in one command; a runbook of
    twenty ``aws`` invocations does it in an afternoon, twice, differently.

2.  A placeholder left unfilled is a silent, expensive failure.  ``<REGION>`` in
    a log group name is accepted by the API and produces a log group called
    ``<REGION>``.  ``--check`` refuses to render until every placeholder has a
    value, so that class of mistake cannot reach the account.

Default behaviour is a DRY RUN: nothing is created, the rendered files are
written to ``deploy/rendered/`` and the AWS CLI commands are printed for review.

    python scripts/provision_aws.py --check                    # values complete?
    python scripts/provision_aws.py --render                   # write deploy/rendered/
    python scripts/provision_aws.py --render --print-commands  # ... and the CLI plan
    python scripts/provision_aws.py --apply                    # actually create things

Values are read from the environment (``PNSM_AWS_ACCOUNT_ID`` and friends), then
overridden by explicit flags.  ``--apply`` additionally needs boto3 and
credentials with administrative rights -- it is run once, by a human, from a
laptop, and never from CI.  The CI deploy role in
``deploy/iam/github-actions-deploy-policy.json`` is deliberately incapable of
running it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_DIR = REPO_ROOT / "deploy"
RENDER_DIR = DEPLOY_DIR / "rendered"

#: Matches ``<UPPER_SNAKE>``. Deliberately narrow: it must not match a JSON
#: comparison operator or an XML-ish fragment inside a comment string.
PLACEHOLDER = re.compile(r"<([A-Z][A-Z0-9_]{2,})>")

#: Files rendered by this script, relative to ``deploy/``.
TEMPLATES = (
    "ecs-task-definition.json",
    "cloudfront-distribution.json",
    "cloudfront-response-headers-policy.json",
    "iam/ai-svc-task-role-policy.json",
    "iam/ecs-execution-role-policy.json",
    "iam/selfie-bucket-policy.json",
    "iam/kms-key-policy.json",
    "iam/github-actions-deploy-role.json",
    "iam/github-actions-deploy-policy.json",
)

#: Placeholders that only exist once AWS has created the resource. They are
#: filled on a second pass, after ``--apply`` learns the id, so ``--check`` does
#: not demand them up front.
DEFERRED = frozenset(
    {
        "KMS_KEY_ARN",
        "SECRETS_KMS_KEY_ARN",
        "ORIGIN_ACCESS_CONTROL_ID",
        "RESPONSE_HEADERS_POLICY_ID",
        "DISTRIBUTION_ID",
        "ACM_CERT_ARN_US_EAST_1",
        "CALLER_REFERENCE",
        "IMAGE_TAG",
        "WAF_WEB_ACL_ARN_OR_EMPTY",
        # Only exists once the distribution has been created, which is the last
        # step. The service starts happily without it -- an empty
        # PNSM_CLOUDFRONT_DOMAIN simply means selfies are served by presigned
        # S3 URLs, which is the documented default anyway (D-14).
        "CLOUDFRONT_DOMAIN",
        "API_ORIGIN",
        "S3_ORIGIN",
        "WEB_DOMAIN",
        "LOG_BUCKET",
    }
)


class ProvisionError(RuntimeError):
    """A value is missing, malformed, or an AWS call failed."""


# ------------------------------------------------------------------- values
@dataclass
class Topology:
    """The handful of values every template is derived from."""

    account_id: str = ""
    region: str = "ap-southeast-1"
    selfie_bucket: str = "pnsm-selfies"
    web_bucket: str = "pnsm-web"
    github_org: str = ""
    github_repo: str = "pnsm"
    extra: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> Topology:
        return cls(
            account_id=os.environ.get("PNSM_AWS_ACCOUNT_ID", ""),
            region=os.environ.get("PNSM_AWS_REGION", "ap-southeast-1"),
            selfie_bucket=os.environ.get("PNSM_S3_BUCKET", "pnsm-selfies"),
            web_bucket=os.environ.get("PNSM_WEB_BUCKET", "pnsm-web"),
            github_org=os.environ.get("PNSM_GITHUB_ORG", ""),
            github_repo=os.environ.get("PNSM_GITHUB_REPO", "pnsm"),
        )

    def validate(self) -> None:
        if not re.fullmatch(r"\d{12}", self.account_id):
            raise ProvisionError(
                f"account id must be exactly 12 digits, got {self.account_id!r}. "
                "Find it with `aws sts get-caller-identity --query Account --output text`."
            )
        if not re.fullmatch(r"[a-z]{2}-[a-z]+-\d", self.region):
            raise ProvisionError(f"{self.region!r} is not an AWS region id (e.g. ap-southeast-1)")
        for name, bucket in (("selfie", self.selfie_bucket), ("web", self.web_bucket)):
            # S3 bucket names are DNS labels. A name with an underscore or an
            # uppercase letter is accepted by nothing and fails at create time
            # with a message that does not say which of the two buckets it meant.
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
                raise ProvisionError(f"{name} bucket {bucket!r} is not a valid S3 bucket name")

    def values(self) -> dict[str, str]:
        """The placeholder substitution map."""
        mapping = {
            "ACCOUNT_ID": self.account_id,
            "REGION": self.region,
            "SELFIE_BUCKET": self.selfie_bucket,
            "WEB_BUCKET": self.web_bucket,
            "GITHUB_ORG": self.github_org,
            "GITHUB_REPO": self.github_repo,
            "CLOUDFRONT_DOMAIN": self.extra.get("CLOUDFRONT_DOMAIN", ""),
        }
        mapping.update(self.extra)
        return {k: v for k, v in mapping.items() if v != ""}


# ------------------------------------------------------------------ rendering
def placeholders_in(text: str) -> set[str]:
    """Every ``<PLACEHOLDER>`` name appearing in ``text``."""
    return set(PLACEHOLDER.findall(text))


def render(text: str, values: dict[str, str]) -> str:
    """Substitute the placeholders present in ``values``, leave the rest alone."""
    return PLACEHOLDER.sub(
        lambda m: values.get(m.group(1), m.group(0)),
        text,
    )


def strip_comments(node: object) -> object:
    """Drop every ``_comment*`` key, recursively.

    The templates carry their reasoning inline so a reviewer reads it beside the
    thing it explains.  AWS accepts unknown keys in some documents and rejects
    them in others (IAM in particular), so they are removed on the way out.
    """
    if isinstance(node, dict):
        return {
            k: strip_comments(v)
            for k, v in node.items()
            if not (isinstance(k, str) and k.startswith("_comment"))
        }
    if isinstance(node, list):
        return [strip_comments(v) for v in node]
    return node


def render_template(path: Path, values: dict[str, str]) -> tuple[str, set[str]]:
    """Render one template. Returns the output and any placeholders left over."""
    raw = path.read_text(encoding="utf-8")
    rendered = render(raw, values)
    remaining = placeholders_in(rendered)

    if path.suffix == ".json":
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProvisionError(f"{path.name} is not valid JSON: {exc}") from exc
        cleaned = strip_comments(parsed)
        rendered = render(json.dumps(cleaned, indent=2) + "\n", values)
        remaining = placeholders_in(rendered)

    return rendered, remaining


def check(values: dict[str, str], *, deploy_dir: Path = DEPLOY_DIR) -> dict[str, set[str]]:
    """Report unresolved, non-deferred placeholders per template."""
    problems: dict[str, set[str]] = {}
    for name in TEMPLATES:
        path = deploy_dir / name
        if not path.exists():
            raise ProvisionError(f"template missing: {path}")
        _, remaining = render_template(path, values)
        blocking = {p for p in remaining if p not in DEFERRED}
        if blocking:
            problems[name] = blocking
    return problems


def write_rendered(values: dict[str, str], *, out_dir: Path = RENDER_DIR) -> list[Path]:
    written: list[Path] = []
    for name in TEMPLATES:
        rendered, _ = render_template(DEPLOY_DIR / name, values)
        target = out_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered, encoding="utf-8")
        written.append(target)
    return written


# -------------------------------------------------------------- command plan
def command_plan(topo: Topology) -> list[tuple[str, str]]:
    """The ordered AWS CLI plan, as ``(what, command)`` pairs.

    Order is not cosmetic. The KMS key must exist before the bucket policy that
    names it; the bucket must exist before the lifecycle rule; the response
    headers policy must exist before the distribution that references it.
    """
    r = topo.region
    out = RENDER_DIR
    return [
        (
            "Biometric CMK -- the key the whole scheme rests on",
            f"aws kms create-key --region {r} --description 'PNSM biometric embedding CMK' "
            f"--key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT "
            f"--policy file://{out}/iam/kms-key-policy.json",
        ),
        (
            "Annual rotation. AWS keeps old key material, so envelopes sealed "
            "last year still open without a migration",
            f"aws kms enable-key-rotation --region {r} --key-id <KMS_KEY_ARN>",
        ),
        (
            "Friendly alias so the ARN never has to be pasted by hand",
            f"aws kms create-alias --region {r} --alias-name alias/pnsm-biometrics "
            f"--target-key-id <KMS_KEY_ARN>",
        ),
        (
            "Selfie bucket",
            f"aws s3api create-bucket --bucket {topo.selfie_bucket} --region {r} "
            f"--create-bucket-configuration LocationConstraint={r}",
        ),
        (
            "Block Public Access -- all four switches, before anything is uploaded",
            f"aws s3api put-public-access-block --bucket {topo.selfie_bucket} "
            "--public-access-block-configuration "
            "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        ),
        (
            "Default SSE-KMS with a bucket key (cuts KMS request cost ~99% on "
            "repeated reads of the same prefix)",
            f"aws s3api put-bucket-encryption --bucket {topo.selfie_bucket} "
            "--server-side-encryption-configuration "
            "'{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":"
            "{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"<KMS_KEY_ARN>\"},"
            "\"BucketKeyEnabled\":true}]}'",
        ),
        (
            "Versioning: a deleted selfie is recoverable during an investigation",
            f"aws s3api put-bucket-versioning --bucket {topo.selfie_bucket} "
            "--versioning-configuration Status=Enabled",
        ),
        (
            "90-day retention. Data minimisation, and the rule -- not the "
            "container -- is what deletes, so the service needs no s3:DeleteObject",
            f"aws s3api put-bucket-lifecycle-configuration --bucket {topo.selfie_bucket} "
            f"--lifecycle-configuration file://{out}/selfie-lifecycle.json",
        ),
        (
            "Bucket policy: the Deny statements nothing can override",
            f"aws s3api put-bucket-policy --bucket {topo.selfie_bucket} "
            f"--policy file://{out}/iam/selfie-bucket-policy.json",
        ),
        (
            "Web bucket for the SPA, also fully private -- CloudFront reads it "
            "through Origin Access Control, the public never touches it",
            f"aws s3api create-bucket --bucket {topo.web_bucket} --region {r} "
            f"--create-bucket-configuration LocationConstraint={r}",
        ),
        (
            "Task role: what the AI container itself may do",
            "aws iam create-role --role-name pnsm-ai-svc-task-role "
            "--assume-role-policy-document "
            '\'{"Version":"2012-10-17","Statement":[{"Effect":"Allow",'
            '"Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}\'',
        ),
        (
            "... and its permissions",
            "aws iam put-role-policy --role-name pnsm-ai-svc-task-role "
            f"--policy-name pnsm-ai-svc-inline --policy-document file://{out}/iam/ai-svc-task-role-policy.json",
        ),
        (
            "Execution role: what the ECS agent may do on the task's behalf",
            "aws iam create-role --role-name pnsm-ecs-execution-role "
            "--assume-role-policy-document "
            '\'{"Version":"2012-10-17","Statement":[{"Effect":"Allow",'
            '"Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}\'',
        ),
        (
            "... and its permissions",
            "aws iam put-role-policy --role-name pnsm-ecs-execution-role "
            f"--policy-name pnsm-ecs-execution-inline --policy-document file://{out}/iam/ecs-execution-role-policy.json",
        ),
        (
            "Secrets. Values come from scripts/gen_keys.py; they are never "
            "written to a file and never committed",
            f"aws secretsmanager create-secret --region {r} --name pnsm/hmac-secret "
            "--secret-string \"$PNSM_HMAC_SECRET\"",
        ),
        (
            "CI deploy role, assumed through GitHub OIDC -- no access keys",
            "aws iam create-role --role-name pnsm-github-deploy "
            f"--assume-role-policy-document file://{out}/iam/github-actions-deploy-role.json",
        ),
        (
            "ECR repository, with scan-on-push (OWASP A03 at the image layer)",
            f"aws ecr create-repository --region {r} --repository-name pnsm-ai-svc "
            "--image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE",
        ),
        (
            "Response headers policy -- returns the id the distribution needs",
            "aws cloudfront create-response-headers-policy "
            f"--cli-input-json file://{out}/cloudfront-response-headers-policy.json",
        ),
        (
            "Origin Access Control, so the web bucket can stay private",
            "aws cloudfront create-origin-access-control --origin-access-control-config "
            '\'{"Name":"pnsm-web-oac","OriginAccessControlOriginType":"s3",'
            '"SigningBehavior":"always","SigningProtocol":"sigv4"}\'',
        ),
        (
            "The distribution, including the 403/404 -> index.html SPA rewrite",
            f"aws cloudfront create-distribution --cli-input-json file://{out}/cloudfront-distribution.json",
        ),
        (
            "ECS cluster and the AI service task definition",
            f"aws ecs create-cluster --region {r} --cluster-name pnsm-cluster",
        ),
        (
            "Register the task definition",
            f"aws ecs register-task-definition --region {r} "
            f"--cli-input-json file://{out}/ecs-task-definition.json",
        ),
    ]


SELFIE_LIFECYCLE = {
    "Rules": [
        {
            "ID": "expire-checkin-selfies-after-90-days",
            "Filter": {"Prefix": "checkins/"},
            "Status": "Enabled",
            "Expiration": {"Days": 90},
            "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
        },
        {
            "ID": "keep-reference-photos-while-employed",
            "Filter": {"Prefix": "refs/"},
            "Status": "Enabled",
            "NoncurrentVersionExpiration": {"NoncurrentDays": 90},
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
        },
    ]
}


# ------------------------------------------------------------------- apply
def apply(topo: Topology) -> int:  # pragma: no cover - needs live AWS
    """Create the KMS key and the two buckets, then stop.

    Only the resources that everything else depends on, and only the ones whose
    creation is idempotent enough to be safe from a script.  The distribution
    and the ECS service are left to the printed plan on purpose: each takes
    minutes to converge, each is awkward to roll back, and a half-applied
    CloudFront distribution is worse than none.
    """
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ModuleNotFoundError:
        raise ProvisionError(
            "--apply needs boto3: pip install boto3 (it is already in requirements.txt)"
        ) from None

    values = topo.values()
    kms = boto3.client("kms", region_name=topo.region)
    s3 = boto3.client("s3", region_name=topo.region)

    key_policy, _ = render_template(DEPLOY_DIR / "iam" / "kms-key-policy.json", values)
    created = kms.create_key(
        Policy=key_policy,
        Description="PNSM biometric embedding CMK",
        KeyUsage="ENCRYPT_DECRYPT",
        KeySpec="SYMMETRIC_DEFAULT",
        Tags=[{"TagKey": "Project", "TagValue": "PNSM"}],
    )
    key_arn = created["KeyMetadata"]["Arn"]
    kms.enable_key_rotation(KeyId=key_arn)
    print(f"created CMK {key_arn}")

    topo.extra["KMS_KEY_ARN"] = key_arn
    topo.extra["SECRETS_KMS_KEY_ARN"] = key_arn
    values = topo.values()

    for bucket in (topo.selfie_bucket, topo.web_bucket):
        try:
            s3.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={"LocationConstraint": topo.region},
            )
        except ClientError as exc:
            if exc.response["Error"]["Code"] not in ("BucketAlreadyOwnedByYou",):
                raise
            print(f"bucket {bucket} already exists; continuing")
        s3.put_public_access_block(
            Bucket=bucket,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )
        s3.put_bucket_encryption(
            Bucket=bucket,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {
                        "ApplyServerSideEncryptionByDefault": {
                            "SSEAlgorithm": "aws:kms",
                            "KMSMasterKeyID": key_arn,
                        },
                        "BucketKeyEnabled": True,
                    }
                ]
            },
        )
        print(f"secured bucket {bucket}: public access blocked, SSE-KMS default")

    s3.put_bucket_lifecycle_configuration(
        Bucket=topo.selfie_bucket, LifecycleConfiguration=SELFIE_LIFECYCLE
    )
    print(f"lifecycle applied to {topo.selfie_bucket}: check-in selfies expire after 90 days")

    write_rendered(values)
    print(f"\nrendered templates written to {RENDER_DIR}")
    print("Remaining steps are printed below; run them after reviewing the rendered files.\n")
    for what, command in command_plan(topo)[10:]:
        print(f"# {what}\n{command}\n")
    return 0


# -------------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--account-id", default=None, help="12-digit AWS account id")
    parser.add_argument("--region", default=None, help="e.g. ap-southeast-1")
    parser.add_argument("--selfie-bucket", default=None)
    parser.add_argument("--web-bucket", default=None)
    parser.add_argument("--github-org", default=None)
    parser.add_argument("--github-repo", default=None)
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="fill a deferred placeholder, e.g. --set KMS_KEY_ARN=arn:aws:kms:...",
    )
    parser.add_argument("--check", action="store_true", help="report unresolved placeholders and exit")
    parser.add_argument("--render", action="store_true", help="write deploy/rendered/")
    parser.add_argument("--print-commands", action="store_true", help="print the AWS CLI plan")
    parser.add_argument("--apply", action="store_true", help="create the KMS key and buckets for real")
    args = parser.parse_args(argv)

    topo = Topology.from_env()
    for name in ("account_id", "region", "selfie_bucket", "web_bucket", "github_org", "github_repo"):
        supplied = getattr(args, name)
        if supplied:
            setattr(topo, name, supplied)
    for pair in args.set:
        if "=" not in pair:
            parser.error(f"--set expects NAME=VALUE, got {pair!r}")
        name, _, value = pair.partition("=")
        topo.extra[name.strip()] = value.strip()

    try:
        topo.validate()
        values = topo.values()
        problems = check(values)

        if problems:
            print("unresolved placeholders:\n", file=sys.stderr)
            for template, names in sorted(problems.items()):
                print(f"  {template}: {', '.join(sorted(names))}", file=sys.stderr)
            print(
                "\nSupply them with flags, environment variables, or --set NAME=VALUE.",
                file=sys.stderr,
            )
            return 1

        if args.check:
            print(f"all templates resolve for account {topo.account_id} in {topo.region}")
            return 0

        if args.apply:
            return apply(topo)

        if args.render or args.print_commands:
            if args.render:
                RENDER_DIR.mkdir(parents=True, exist_ok=True)
                (RENDER_DIR / "selfie-lifecycle.json").write_text(
                    json.dumps(SELFIE_LIFECYCLE, indent=2) + "\n", encoding="utf-8"
                )
                for path in write_rendered(values):
                    print(f"wrote {path.relative_to(REPO_ROOT)}")
            if args.print_commands:
                print()
                for what, command in command_plan(topo):
                    print(f"# {what}\n{command}\n")
            return 0

        parser.print_help()
        return 0
    except ProvisionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
