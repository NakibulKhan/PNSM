#!/usr/bin/env python3
"""Supply-chain gate: fail the build on a vulnerable dependency.

The master plan's OWASP A03 requirement, in executable form:

    "The CI/CD pipeline must be configured to halt deployments if the
     npm audit command detects deep-tree vulnerabilities. The deployment
     environments must strictly utilize npm ci paired with locked
     package-lock.json manifests."

The plan names ``npm audit`` because it was written about the MERN half of the
system.  The same reasoning applies with equal force to this service's Python
dependencies, so this script runs both and reports them together: a poisoned
``onnxruntime`` compromises the AWS cluster exactly as thoroughly as a poisoned
npm transitive.

Sibling frontend and backend checkouts are audited too when they are present,
so one command covers all four quadrants:

    python scripts/audit_deps.py                     # this service only
    python scripts/audit_deps.py --npm ../pnsm-web ../pnsm-api
    python scripts/audit_deps.py --severity critical # relax the gate

Exit codes
    0  clean, or only findings below the threshold
    1  a finding at or above the threshold -- the deployment must not proceed
    2  the audit could not run (tool missing, no network, malformed output)

Exit code 2 is deliberately distinct from 1.  "We found nothing because we
could not look" is not the same as "we looked and it is clean", and a pipeline
that treats them alike is a pipeline that goes green during an outage of the
advisory database.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Ordered low to high, so a threshold is a simple index comparison.
SEVERITIES = ("info", "low", "moderate", "high", "critical")

#: pip-audit and npm audit do not agree on vocabulary.
NORMALISE = {
    "informational": "info",
    "info": "info",
    "low": "low",
    "medium": "moderate",
    "moderate": "moderate",
    "high": "high",
    "critical": "critical",
    "": "moderate",  # pip-audit often reports no severity at all; see below
}

AUDIT_TIMEOUT_S = 300


@dataclass(frozen=True)
class Finding:
    ecosystem: str
    package: str
    installed: str
    advisory: str
    severity: str
    fixed_in: str

    def line(self) -> str:
        fix = f"fixed in {self.fixed_in}" if self.fixed_in else "no fix published"
        return (
            f"  [{self.severity:<8}] {self.ecosystem:<6} {self.package} {self.installed} "
            f"-- {self.advisory} ({fix})"
        )


class AuditUnavailable(RuntimeError):
    """The audit could not be performed. Distinct from 'the audit passed'."""


def rank(severity: str) -> int:
    return SEVERITIES.index(NORMALISE.get(severity.lower(), "moderate"))


def _run(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=AUDIT_TIMEOUT_S,
            check=False,
        )
    except FileNotFoundError as exc:
        raise AuditUnavailable(f"{command[0]} is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise AuditUnavailable(f"{' '.join(command[:2])} timed out after {AUDIT_TIMEOUT_S}s") from exc


# ------------------------------------------------------------------- python
def parse_pip_audit(payload: str) -> list[Finding]:
    """Parse ``pip-audit --format json``.

    pip-audit has emitted two shapes over its life: a bare list of dependencies,
    and a dict with a ``dependencies`` key. Both are handled, because pinning
    the parser to whichever one is current is how this script silently reports
    "clean" after a routine upgrade.
    """
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AuditUnavailable(f"pip-audit produced output that is not JSON: {exc}") from exc

    entries = data.get("dependencies", []) if isinstance(data, dict) else data
    findings: list[Finding] = []
    for entry in entries:
        name = entry.get("name", "?")
        version = entry.get("version", "?")
        for vuln in entry.get("vulns", []) or []:
            fixes = vuln.get("fix_versions") or []
            findings.append(
                Finding(
                    ecosystem="pypi",
                    package=name,
                    installed=version,
                    advisory=vuln.get("id", "?"),
                    # PyPI advisories frequently carry no severity at all. They
                    # are treated as 'moderate' rather than dropped: an
                    # unrated advisory is unrated, not harmless.
                    severity=NORMALISE.get(str(vuln.get("severity", "")).lower(), "moderate"),
                    fixed_in=", ".join(fixes),
                )
            )
    return findings


def audit_python(root: Path) -> list[Finding]:
    if shutil.which("pip-audit") is None:
        raise AuditUnavailable(
            "pip-audit is not installed. `pip install pip-audit` "
            "(it is already in requirements-dev.txt)"
        )
    requirement_files = [p for p in ("requirements.lock", "requirements.txt") if (root / p).exists()]
    if not requirement_files:
        raise AuditUnavailable(f"no requirements file under {root}")

    command = ["pip-audit", "--format", "json", "--progress-spinner", "off"]
    for name in requirement_files[:1]:  # the lock when present, else the ranges
        command += ["--requirement", name]

    result = _run(command, root)
    # pip-audit exits 1 when it finds something, which is not a failure to run.
    if result.returncode not in (0, 1) and not result.stdout.strip():
        raise AuditUnavailable(f"pip-audit failed: {result.stderr.strip()[:400]}")
    return parse_pip_audit(result.stdout)


# ---------------------------------------------------------------------- npm
def parse_npm_audit(payload: str) -> list[Finding]:
    """Parse ``npm audit --json`` (npm 7+ schema).

    npm 6 used a completely different ``advisories`` shape. This project pins
    Node 24, so only the current schema is parsed -- but an unrecognised
    document raises rather than returning an empty list, so an npm downgrade
    surfaces as a broken gate rather than a passing one.
    """
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise AuditUnavailable(f"npm audit produced output that is not JSON: {exc}") from exc

    if "vulnerabilities" not in data:
        if "advisories" in data:
            raise AuditUnavailable(
                "npm audit returned the npm 6 schema. This project requires Node 24; "
                "check which npm is on PATH."
            )
        raise AuditUnavailable("npm audit output has neither 'vulnerabilities' nor 'advisories'")

    findings: list[Finding] = []
    for name, entry in (data.get("vulnerabilities") or {}).items():
        severity = str(entry.get("severity", "moderate")).lower()
        via = entry.get("via") or []
        titles = [v.get("title", "?") for v in via if isinstance(v, dict)]
        # A string in `via` means "vulnerable only because it depends on that
        # package" -- the deep-tree case the master plan calls out by name.
        indirect = [v for v in via if isinstance(v, str)]
        advisory = "; ".join(titles) or (f"transitive via {', '.join(indirect)}" if indirect else "?")
        fix = entry.get("fixAvailable")
        fixed_in = ""
        if isinstance(fix, dict):
            fixed_in = f"{fix.get('name', name)}@{fix.get('version', '?')}"
            if fix.get("isSemVerMajor"):
                fixed_in += " (major upgrade)"
        elif fix is True:
            fixed_in = "npm audit fix"
        findings.append(
            Finding(
                ecosystem="npm",
                package=name,
                installed=str(entry.get("range", "?")),
                advisory=advisory[:120],
                severity=NORMALISE.get(severity, "moderate"),
                fixed_in=fixed_in,
            )
        )
    return findings


def audit_npm(project: Path) -> list[Finding]:
    if not (project / "package.json").exists():
        raise AuditUnavailable(f"no package.json in {project}")
    if not (project / "package-lock.json").exists():
        # The master plan is explicit that deployments use `npm ci` with a
        # locked manifest. Without the lock there is no deterministic tree to
        # audit, and `npm ci` itself would refuse to run.
        raise AuditUnavailable(
            f"{project} has no package-lock.json. Commit it: `npm ci` requires it, "
            "and an unlocked tree is the supply-chain risk A03 describes."
        )
    if shutil.which("npm") is None:
        raise AuditUnavailable("npm is not installed")

    result = _run(["npm", "audit", "--json", "--omit", "dev"], project)
    if not result.stdout.strip():
        raise AuditUnavailable(f"npm audit produced no output: {result.stderr.strip()[:400]}")
    return parse_npm_audit(result.stdout)


# ------------------------------------------------------------------- report
def report(findings: list[Finding], threshold: str) -> int:
    limit = rank(threshold)
    blocking = [f for f in findings if rank(f.severity) >= limit]
    below = [f for f in findings if rank(f.severity) < limit]

    if below:
        print(f"{len(below)} finding(s) below the {threshold} threshold:")
        for finding in sorted(below, key=lambda f: -rank(f.severity)):
            print(finding.line())
        print()

    if not blocking:
        print(f"supply-chain gate passed: no finding at or above '{threshold}'.")
        return 0

    print(f"BLOCKING: {len(blocking)} finding(s) at or above '{threshold}':")
    for finding in sorted(blocking, key=lambda f: -rank(f.severity)):
        print(finding.line())
    print(
        "\nThe deployment must not proceed (OWASP A03, master plan).\n"
        "Upgrade the package, or -- if there is genuinely no fix -- record the\n"
        "decision in docs/DECISIONS.md and pass --severity to raise the bar\n"
        "deliberately, in a commit somebody reviews."
    )
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--severity",
        default="high",
        choices=SEVERITIES,
        help="block at this severity or above (default: high)",
    )
    parser.add_argument(
        "--npm",
        nargs="*",
        default=[],
        metavar="DIR",
        help="also audit these Node projects (Person 1, 2 and 3's checkouts)",
    )
    parser.add_argument("--skip-python", action="store_true")
    parser.add_argument(
        "--allow-unavailable",
        action="store_true",
        help="treat an audit that could not run as a warning instead of exit 2. "
        "For local use on a machine with no network -- never in CI.",
    )
    args = parser.parse_args(argv)

    findings: list[Finding] = []
    unavailable: list[str] = []

    if not args.skip_python:
        try:
            found = audit_python(REPO_ROOT)
            print(f"pypi: audited, {len(found)} finding(s)")
            findings += found
        except AuditUnavailable as exc:
            unavailable.append(f"python: {exc}")

    for raw in args.npm:
        project = Path(raw).expanduser().resolve()
        try:
            found = audit_npm(project)
            print(f"npm ({project.name}): audited, {len(found)} finding(s)")
            findings += found
        except AuditUnavailable as exc:
            unavailable.append(f"npm {project}: {exc}")

    if unavailable:
        print("\naudits that could not run:")
        for note in unavailable:
            print(f"  ! {note}")
        if not args.allow_unavailable:
            print(
                "\nExiting 2. An audit that did not run is not a passing audit;\n"
                "a pipeline that treats the two alike goes green during an\n"
                "advisory-database outage. Pass --allow-unavailable only locally."
            )
            return 2
        print("  (continuing: --allow-unavailable)\n")

    print()
    return report(findings, args.severity)


if __name__ == "__main__":
    raise SystemExit(main())
