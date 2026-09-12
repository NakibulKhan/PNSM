"""The three places that set security headers must agree.

The PNSM system emits responses from three different servers, and OWASP A02 is
only satisfied if all three are hardened:

    app/security/headers.py                          this FastAPI service
    deploy/nginx.conf.template                       a frontend running as an ECS task
    deploy/cloudfront-response-headers-policy.json   the SPA served from S3

Three copies of a policy drift. The failure is quiet and asymmetric: an attacker
simply routes around whichever copy was forgotten. So the copies are compared
here rather than trusted to stay in step by good intentions.

They are deliberately not identical -- a JSON API and an HTML page need
different policies -- so this module asserts the specific properties each one
must hold, and equality only where equality is actually required.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.security.headers import PERMISSIONS_POLICY, describe_policy
from tests.helpers import make_settings

REPO_ROOT = Path(__file__).resolve().parents[2]
NGINX_TEMPLATE = REPO_ROOT / "deploy" / "nginx.conf.template"
CLOUDFRONT_POLICY = REPO_ROOT / "deploy" / "cloudfront-response-headers-policy.json"


def nginx_headers() -> dict[str, str]:
    """Pull the ``add_header`` directives out of the template."""
    text = NGINX_TEMPLATE.read_text(encoding="utf-8")
    found: dict[str, str] = {}
    for match in re.finditer(r'^\s*add_header\s+(\S+)\s+"(.*?)"\s+always;', text, re.MULTILINE):
        found[match.group(1)] = match.group(2)
    return found


def cloudfront_config() -> dict:
    """The policy config, unwrapped from the envelope the CLI requires."""
    return json.loads(CLOUDFRONT_POLICY.read_text(encoding="utf-8"))["ResponseHeadersPolicyConfig"]


def cloudfront_headers() -> dict[str, str]:
    config = cloudfront_config()
    security = config["SecurityHeadersConfig"]
    headers = {
        "Content-Security-Policy": security["ContentSecurityPolicy"]["ContentSecurityPolicy"],
        "X-Frame-Options": security["FrameOptions"]["FrameOption"],
        "Referrer-Policy": security["ReferrerPolicy"]["ReferrerPolicy"],
    }
    for item in config["CustomHeadersConfig"]["Items"]:
        headers[item["Header"]] = item["Value"]
    return headers


def normalise_csp(policy: str) -> dict[str, set[str]]:
    """A CSP as ``{directive: {source, ...}}``, so ordering cannot cause a diff."""
    directives: dict[str, set[str]] = {}
    for chunk in policy.split(";"):
        parts = chunk.split()
        if parts:
            directives[parts[0]] = set(parts[1:])
    return directives


# ------------------------------------------------------- the frontend pair
def test_the_two_frontend_policies_are_the_same_policy() -> None:
    """One bundle, two possible servers. A viewer must not get a weaker one."""
    nginx = normalise_csp(nginx_headers()["Content-Security-Policy"])
    cloudfront = normalise_csp(cloudfront_headers()["Content-Security-Policy"])

    # The two carry different placeholder spellings for the same two origins
    # (${PNSM_API_ORIGIN} against <API_ORIGIN>), so connect-src is compared by
    # its fixed part and checked separately below.
    del nginx["connect-src"], cloudfront["connect-src"]

    assert nginx == cloudfront, (
        "the nginx template and the CloudFront policy have drifted; "
        f"only in nginx: {set(nginx) - set(cloudfront)}, "
        f"only in CloudFront: {set(cloudfront) - set(nginx)}"
    )


def test_both_frontend_policies_allow_the_api_and_the_bucket_and_nothing_else() -> None:
    for label, csp in (
        ("nginx", nginx_headers()["Content-Security-Policy"]),
        ("cloudfront", cloudfront_headers()["Content-Security-Policy"]),
    ):
        connect = normalise_csp(csp)["connect-src"]
        assert "'self'" in connect, label
        assert len(connect) == 3, f"{label}: connect-src should be self + api + bucket, got {connect}"
        assert "*" not in connect, label
        assert "https:" not in connect, f"{label}: a scheme source allows every host on the web"


def test_both_frontend_policies_deny_framing() -> None:
    assert nginx_headers()["X-Frame-Options"] == "DENY"
    assert cloudfront_headers()["X-Frame-Options"] == "DENY"
    for csp in (
        nginx_headers()["Content-Security-Policy"],
        cloudfront_headers()["Content-Security-Policy"],
    ):
        # X-Frame-Options is the legacy control; frame-ancestors is the one
        # modern browsers actually honour. Both, because both audiences exist.
        assert normalise_csp(csp)["frame-ancestors"] == {"'none'"}


def test_the_permissions_policy_grants_only_the_two_sensors_the_product_needs() -> None:
    for label, value in (
        ("nginx", nginx_headers()["Permissions-Policy"]),
        ("cloudfront", cloudfront_headers()["Permissions-Policy"]),
    ):
        assert "camera=(self)" in value, label
        assert "geolocation=(self)" in value, label
        assert "microphone=()" in value, f"{label}: the check-in flow never records audio"
        assert "payment=()" in value, label


def test_both_frontend_policies_ship_hsts() -> None:
    assert "max-age=31536000" in nginx_headers()["Strict-Transport-Security"]
    hsts = cloudfront_config()["SecurityHeadersConfig"]["StrictTransportSecurity"]
    assert hsts["AccessControlMaxAgeSec"] >= 31_536_000
    assert hsts["IncludeSubdomains"] is True


# ---------------------------------------------------- the API is different
def test_the_api_runs_a_strictly_tighter_policy_than_the_frontends() -> None:
    """It returns only JSON, so it can afford to allow nothing at all."""
    settings = make_settings()
    api = normalise_csp(settings.csp_policy)
    assert api["default-src"] == {"'none'"}
    assert api["frame-ancestors"] == {"'none'"}
    assert "script-src" not in api, "a JSON API has no scripts to allow"

    frontend = normalise_csp(nginx_headers()["Content-Security-Policy"])
    assert frontend["default-src"] == {"'self'"}, "an HTML page needs its own origin"


def test_the_api_and_the_frontends_agree_on_the_permissions_policy() -> None:
    """One value, so a sensor cannot be denied in one place and granted next door."""
    assert PERMISSIONS_POLICY.count("camera=") == 1
    assert "microphone=()" in PERMISSIONS_POLICY
    # The API denies the camera outright: nothing it serves opens one.
    assert "camera=()" in PERMISSIONS_POLICY


def test_the_api_policy_description_is_reported_accurately() -> None:
    settings = make_settings()
    described = describe_policy(settings.csp_policy, settings.hsts_max_age_s)
    assert described["content-security-policy"] == settings.csp_policy
    assert described["x-frame-options"] == "DENY"
    assert "max-age" in described["strict-transport-security"]
