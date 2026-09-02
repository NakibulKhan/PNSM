"""The supply-chain gate must fail closed.

A dependency audit is only worth having if it is impossible for it to report
"clean" when it did not actually look.  Every test here is about that property
rather than about finding vulnerabilities: the interesting failure mode of a
security gate is the one where it passes.

Reference: master plan, OWASP A03 -- "halt deployments if the npm audit command
detects deep-tree vulnerabilities".
"""

from __future__ import annotations

import json

import pytest

from scripts.audit_deps import (
    SEVERITIES,
    AuditUnavailable,
    Finding,
    parse_npm_audit,
    parse_pip_audit,
    rank,
    report,
)


def finding(severity: str, package: str = "left-pad") -> Finding:
    return Finding(
        ecosystem="npm",
        package=package,
        installed="1.0.0",
        advisory="CVE-0000-0000",
        severity=severity,
        fixed_in="1.0.1",
    )


# ------------------------------------------------------------------ ranking
def test_severities_are_ordered_from_harmless_to_urgent() -> None:
    assert rank("info") < rank("low") < rank("moderate") < rank("high") < rank("critical")


def test_vocabulary_differences_between_the_two_tools_are_reconciled() -> None:
    """pip-audit says 'medium'; npm says 'moderate'. They must rank the same."""
    assert rank("medium") == rank("moderate")
    assert rank("MODERATE") == rank("moderate")


def test_an_unrated_advisory_is_treated_as_moderate_not_dropped() -> None:
    """PyPI advisories frequently carry no severity. Unrated is not harmless."""
    assert rank("") == rank("moderate")
    assert rank("something-nobody-has-seen") == rank("moderate")


# -------------------------------------------------------------- pip-audit
def test_pip_audit_findings_are_extracted_from_the_current_schema() -> None:
    payload = json.dumps(
        {
            "dependencies": [
                {"name": "clean-pkg", "version": "1.0.0", "vulns": []},
                {
                    "name": "bad-pkg",
                    "version": "2.1.0",
                    "vulns": [
                        {"id": "GHSA-xxxx", "fix_versions": ["2.1.1"], "severity": "high"}
                    ],
                },
            ]
        }
    )
    findings = parse_pip_audit(payload)
    assert len(findings) == 1
    assert findings[0].package == "bad-pkg"
    assert findings[0].severity == "high"
    assert findings[0].fixed_in == "2.1.1"


def test_pip_audits_older_bare_list_shape_is_still_understood() -> None:
    """Pinning the parser to one shape is how a gate goes quiet after an upgrade."""
    payload = json.dumps(
        [{"name": "bad-pkg", "version": "2.1.0", "vulns": [{"id": "PYSEC-1", "fix_versions": []}]}]
    )
    findings = parse_pip_audit(payload)
    assert len(findings) == 1
    assert findings[0].fixed_in == "", "no fix published must be visible, not blank-and-forgotten"


def test_output_that_is_not_json_is_an_outage_not_a_pass() -> None:
    with pytest.raises(AuditUnavailable):
        parse_pip_audit("ERROR: could not reach https://pypi.org/")


# ------------------------------------------------------------------ npm
def test_npm_findings_include_the_deep_tree_case_the_plan_names() -> None:
    payload = json.dumps(
        {
            "vulnerabilities": {
                "minimist": {
                    "severity": "critical",
                    "range": "<1.2.6",
                    "via": [{"title": "Prototype Pollution"}],
                    "fixAvailable": {"name": "minimist", "version": "1.2.6"},
                },
                "mkdirp": {
                    "severity": "critical",
                    "range": "0.4.0 - 0.5.1",
                    # A string in `via` is npm's way of saying "vulnerable only
                    # because of what it depends on" -- a transitive, which is
                    # exactly what "deep-tree vulnerabilities" means.
                    "via": ["minimist"],
                    "fixAvailable": True,
                },
            }
        }
    )
    findings = {f.package: f for f in parse_npm_audit(payload)}
    assert set(findings) == {"minimist", "mkdirp"}
    assert "transitive via minimist" in findings["mkdirp"].advisory
    assert findings["minimist"].fixed_in == "minimist@1.2.6"


def test_a_breaking_fix_is_labelled_as_one() -> None:
    """A silent major upgrade is how a security fix becomes an outage."""
    payload = json.dumps(
        {
            "vulnerabilities": {
                "old-pkg": {
                    "severity": "high",
                    "range": "*",
                    "via": [{"title": "RCE"}],
                    "fixAvailable": {"name": "old-pkg", "version": "3.0.0", "isSemVerMajor": True},
                }
            }
        }
    )
    assert "major upgrade" in parse_npm_audit(payload)[0].fixed_in


def test_a_clean_tree_produces_no_findings() -> None:
    assert parse_npm_audit(json.dumps({"vulnerabilities": {}})) == []


def test_the_npm_6_schema_is_refused_rather_than_read_as_clean() -> None:
    """npm 6's shape has no 'vulnerabilities' key; parsing it loosely returns []."""
    payload = json.dumps({"advisories": {"118": {"severity": "critical"}}, "metadata": {}})
    with pytest.raises(AuditUnavailable) as caught:
        parse_npm_audit(payload)
    assert "npm 6" in str(caught.value)


def test_unrecognised_output_is_refused() -> None:
    with pytest.raises(AuditUnavailable):
        parse_npm_audit(json.dumps({"something": "else"}))


# --------------------------------------------------------------- the gate
def test_a_high_finding_blocks_the_deployment() -> None:
    assert report([finding("high")], "high") == 1
    assert report([finding("critical")], "high") == 1


def test_findings_below_the_threshold_are_reported_but_do_not_block() -> None:
    """Visible, because a low finding today is a high one after a reclassification."""
    assert report([finding("low"), finding("moderate")], "high") == 0


def test_a_clean_run_passes() -> None:
    assert report([], "high") == 0


def test_the_threshold_can_be_raised_deliberately() -> None:
    assert report([finding("high")], "critical") == 0
    assert report([finding("critical")], "critical") == 1


@pytest.mark.parametrize("severity", SEVERITIES)
def test_every_severity_blocks_at_its_own_level(severity: str) -> None:
    assert report([finding(severity)], severity) == 1
