#!/usr/bin/env python3
"""End-to-end smoke test against a running service.

Runs the whole check-in story -- enrol, match, mismatch, and every security
guard -- against a real HTTP endpoint. Use it after a deploy, and again half an
hour before a demo.

    python scripts/smoke.py                              # local
    python scripts/smoke.py --base-url https://ai.pnsm.example.com

Reads ``PNSM_HMAC_SECRET`` and ``PNSM_ADMIN_TOKEN`` from the environment.
Cross-platform on purpose: the team develops on Windows.
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

PASSED = 0
FAILED: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}{('  ' + detail) if detail else ''}")


def request(
    base_url: str,
    path: str,
    payload: dict | None = None,
    *,
    secret: bytes | None = None,
    admin_token: str = "",
    method: str | None = None,
) -> tuple[int, dict]:
    from app.crypto import hmac_auth

    body = json.dumps(payload).encode("utf-8") if payload is not None else b""
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if secret:
        timestamp = hmac_auth.current_timestamp()
        headers[hmac_auth.TIMESTAMP_HEADER] = timestamp
        headers[hmac_auth.SIGNATURE_HEADER] = hmac_auth.sign(secret, timestamp, body)
    if admin_token:
        headers["X-PNSM-Admin"] = admin_token

    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=body if payload is not None else None,
        headers=headers,
        method=method or ("POST" if payload is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return exc.code, {"raw": raw.decode("utf-8", "replace")[:400]}
    except Exception as exc:
        return 0, {"error": {"code": "TRANSPORT", "message": str(exc)}}


def ulid(suffix: str) -> str:
    """A syntactically valid ULID seeded by the clock, unique per run."""
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    stamp = int(time.time() * 1000)
    body = ""
    for _ in range(20):
        body = alphabet[stamp % 32] + body
        stamp //= 32
    return (body + suffix.upper())[:26].ljust(26, "Z")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default=os.environ.get("PNSM_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--user-ref", default="smoketest")
    args = parser.parse_args()

    secret_raw = os.environ.get("PNSM_HMAC_SECRET", "")
    if not secret_raw:
        raise SystemExit("PNSM_HMAC_SECRET is not set. Source your .env first.")
    secret = base64.b64decode(secret_raw)
    admin_token = os.environ.get("PNSM_ADMIN_TOKEN", "")

    from tests.helpers import synthetic_jpeg

    def image(seed: int) -> dict:
        return {"kind": "base64", "value": base64.b64encode(synthetic_jpeg(seed)).decode()}

    def now() -> str:
        return _dt.datetime.now(_dt.UTC).isoformat()

    print(f"\nSmoke test against {args.base_url}\n")

    # ------------------------------------------------------------ liveness
    print("liveness")
    started = time.perf_counter()
    status, body = request(args.base_url, "/health")
    health_ms = (time.perf_counter() - started) * 1000.0
    check("/health returns 200", status == 200, str(body))
    check("/health is fast enough for an uptime-monitoring ping", health_ms < 2000, f"{health_ms:.0f} ms")

    status, ready = request(args.base_url, "/ready")
    check("/ready returns 200", status == 200, str(ready))
    check("service is warm", bool(ready.get("warm")), "cold: the first check-in will be slow")
    if ready.get("thresholds"):
        thresholds = ready["thresholds"]
        print(f"        calibration : {thresholds.get('calibration_version')}")
        print(f"        approve at  : cosine {thresholds.get('approve_at_cosine')}")
        cosine_at_approve = thresholds.get("approve_at_cosine") or 0
        check(
            "approve threshold sits in a reachable cosine range",
            0.30 < float(cosine_at_approve) < 0.80,
            f"cosine {cosine_at_approve} -- refit the calibration",
        )

    # --------------------------------------------------------------- auth
    print("\nauthentication")
    status, _ = request(args.base_url, "/v1/embed", {"user_ref": "x"})
    check("unsigned business request is refused", status == 401)

    # -------------------------------------------------------------- enrol
    print("\nenrolment")
    status, enrolled = request(
        args.base_url,
        "/v1/embed",
        {"user_ref": args.user_ref, "image": image(1), "request_id": ulid("A")},
        secret=secret,
    )
    check("enrolment succeeds", status == 200, str(enrolled)[:200])
    envelope = enrolled.get("envelope", {})
    check("an encrypted envelope comes back", envelope.get("alg") == "AES-256-GCM")
    check("no plaintext vector is returned", "vector" not in json.dumps(enrolled))

    if not envelope:
        print("\nCannot continue without an envelope.")
        return 1

    # ------------------------------------------------------------- verify
    print("\nverification")

    def verify(seed: int, suffix: str, **overrides) -> tuple[int, dict]:
        payload = {
            "user_ref": args.user_ref,
            "image": image(seed),
            "envelope": envelope,
            "request_id": ulid(suffix),
            "captured_at": now(),
            "device": {"platform": "android", "is_mock_location": False},
        }
        payload.update(overrides)
        return request(args.base_url, "/v1/verify", payload, secret=secret)

    started = time.perf_counter()
    status, matched = verify(1, "B")
    verify_ms = (time.perf_counter() - started) * 1000.0
    check("the same face approves", status == 200 and matched.get("decision") == "approved", str(matched)[:200])
    check("verification fits the 3-second budget", verify_ms < 3000, f"{verify_ms:.0f} ms")
    if matched.get("decision"):
        print(f"        confidence {matched.get('confidence')}  raw cosine {matched.get('raw_cosine')}")
        check(
            "confidence is calibrated, not cosine x 100",
            abs(matched.get("confidence", 0) - matched.get("raw_cosine", 0) * 100) > 1e-6
            or matched.get("raw_cosine") == 1.0,
        )

    status, other = verify(99, "C")
    check("a different face is rejected", status == 200 and other.get("decision") == "rejected", str(other)[:200])

    # ------------------------------------------------------------ guards
    print("\nsecurity guards")
    status, _ = verify(1, "D", device={"platform": "android", "is_mock_location": True})
    check("mock location returns 403", status == 403)

    status, _ = verify(1, "E", device={"platform": "android", "is_emulator": True})
    check("emulator returns 403", status == 403)

    stale = (_dt.datetime.now(_dt.UTC) - _dt.timedelta(hours=2)).isoformat()
    status, _ = verify(1, "F", captured_at=stale)
    check("a stale capture returns 409", status == 409)

    replayed = ulid("G")
    verify(2, "H", request_id=replayed)
    status, _ = verify(3, "H", request_id=replayed)
    check("a reused request id returns 409", status == 409)

    status, _ = verify(1, "J")
    check("a reused selfie returns 409", status == 409, "image-replay guard did not fire")

    # --------------------------------------------------------------- pin
    print("\npin")
    status, record = request(
        args.base_url, "/v1/security/pin/hash", {"user_ref": args.user_ref, "pin": "418362"}, secret=secret
    )
    check("a strong pin hashes", status == 200, str(record)[:200])
    if status == 200:
        stored = record["pin_hash"]
        _, good = request(
            args.base_url,
            "/v1/security/pin/verify",
            {"user_ref": args.user_ref, "pin": "418362", "pin_hash": stored},
            secret=secret,
        )
        check("the correct pin matches", good.get("match") is True)
        _, bad = request(
            args.base_url,
            "/v1/security/pin/verify",
            {"user_ref": args.user_ref, "pin": "999111", "pin_hash": stored},
            secret=secret,
        )
        check("a wrong pin does not match and burns an attempt", bad.get("match") is False)

    status, _ = request(
        args.base_url, "/v1/security/pin/hash", {"user_ref": args.user_ref, "pin": "123456"}, secret=secret
    )
    check("a weak pin is refused", status == 400)

    # ----------------------------------------------------------- storage
    print("\nstorage")
    status, signed = request(
        args.base_url,
        "/v1/storage/presign-put",
        {
            "user_ref": args.user_ref,
            "purpose": "checkin",
            "object_id": ulid("K"),
            "content_type": "image/webp",
            "content_length": 150_000,
        },
        secret=secret,
    )
    check("presign-put succeeds", status == 200, str(signed)[:200])
    check("the key is built server-side", str(signed.get("object_key", "")).startswith("checkins/"))

    status, _ = request(
        args.base_url, "/v1/storage/presign-get", {"object_key": "refs/../../etc/passwd"}, secret=secret
    )
    check("traversal in a key is refused", status == 400)

    # ------------------------------------------------------------- admin
    if admin_token:
        print("\nadmin")
        status, _ = request(args.base_url, "/metrics", secret=secret, admin_token=admin_token)
        check("/metrics is reachable with the admin token", status == 200)
        status, _ = request(args.base_url, "/metrics", secret=secret)
        check("/metrics is closed without it", status == 401)

    print("\n" + "=" * 62)
    print(f"smoke test: {PASSED} passed, {len(FAILED)} failed")
    for label in FAILED:
        print(f"  FAILED: {label}")
    print("=" * 62)
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
