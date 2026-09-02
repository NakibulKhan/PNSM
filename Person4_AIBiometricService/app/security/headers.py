"""Security response headers -- OWASP A02:2025, Security Misconfiguration.

The master plan mandates ``helmet`` on Person 3's Express runtime, with a
strict ``Content-Security-Policy`` and ``X-Frame-Options: DENY``.  This module
is the equivalent for the Python service, so the whole platform presents one
posture rather than a hardened Node tier next to a bare Python one.

Two things make this service's policy stricter than a typical web app's:

* it returns **only JSON**, so it can afford ``default-src 'none'`` -- there is
  no script, style, image or font it ever legitimately loads;
* it handles **biometric data**, so every response carries ``Cache-Control:
  no-store``. A match score sitting in an intermediary cache is a disclosure,
  and the default caching heuristics would happily keep one.

The interactive documentation is the single exception: Swagger UI pulls its
bundle from a CDN, so ``/docs`` gets a narrowly widened policy rather than the
whole service being loosened to accommodate one page.

Reference: master plan, Quadrant IV -- "Cloud Security and OWASP Compliance".
"""

from __future__ import annotations

from collections.abc import Iterable

from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: Paths whose CSP is widened for the bundled documentation UI.
DOCS_PATHS: tuple[str, ...] = ("/docs", "/redoc")

#: CSP for the documentation pages. Swagger UI and ReDoc load their bundle and
#: stylesheet from jsdelivr and inline a small bootstrap script.
DOCS_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "font-src 'self' https://cdn.jsdelivr.net; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'"
)

#: This API never needs a device capability. Denying them all means a
#: compromised response cannot ask a browser for the camera it does not use.
PERMISSIONS_POLICY = (
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), "
    "microphone=(), payment=(), usb=(), interest-cohort=()"
)


class SecurityHeadersMiddleware:
    """Attach the hardening headers to every response.

    Implemented as raw ASGI so it wraps error responses produced by the
    middleware above it too -- a 401 from the signature check is a response
    like any other, and shipping it without these headers would leave a hole
    exactly where an attacker is looking.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        csp: str,
        hsts_max_age_s: int,
        enabled: bool = True,
        docs_paths: Iterable[str] = DOCS_PATHS,
    ) -> None:
        self.app = app
        self._csp = csp
        self._hsts = hsts_max_age_s
        self._enabled = enabled
        self._docs_paths = tuple(docs_paths)

    def _headers_for(self, path: str, scheme: str) -> list[tuple[bytes, bytes]]:
        is_docs = any(path == p or path.startswith(p + "/") for p in self._docs_paths)
        policy = DOCS_CSP if is_docs else self._csp

        headers: list[tuple[bytes, bytes]] = [
            (b"content-security-policy", policy.encode("latin-1")),
            (b"x-frame-options", b"DENY"),
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"permissions-policy", PERMISSIONS_POLICY.encode("latin-1")),
            (b"cross-origin-opener-policy", b"same-origin"),
            (b"cross-origin-resource-policy", b"same-origin"),
            (b"x-permitted-cross-domain-policies", b"none"),
        ]
        # Biometric scores and presigned URLs must not be cached anywhere.
        if not is_docs:
            headers.append((b"cache-control", b"no-store, no-cache, must-revalidate, private"))
            headers.append((b"pragma", b"no-cache"))
        # HSTS is meaningless (and ignored) over plaintext, and setting it in
        # local development would poison the developer's browser for localhost.
        if self._hsts > 0 and scheme == "https":
            headers.append(
                (
                    b"strict-transport-security",
                    f"max-age={self._hsts}; includeSubDomains".encode("latin-1"),
                )
            )
        return headers

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self._enabled or scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        scheme = scope.get("scheme", "http")
        # Behind an ALB or CloudFront the connection to the container is plain
        # HTTP; the client's scheme is in the forwarded header.
        forwarded = {
            k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])
        }.get("x-forwarded-proto")
        if forwarded:
            scheme = forwarded.split(",")[0].strip()

        extra = self._headers_for(path, scheme)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = list(message.get("headers", []))
                present = {name.lower() for name, _ in existing}
                # Never clobber a header a handler set deliberately.
                merged = existing + [(n, v) for n, v in extra if n not in present]
                # The default Server banner names the framework and version,
                # which is free reconnaissance.
                merged = [(n, v) for n, v in merged if n.lower() != b"server"]
                message = {**message, "headers": merged}
            await send(message)

        await self.app(scope, receive, send_with_headers)


def describe_policy(csp: str, hsts_max_age_s: int) -> dict[str, str]:
    """The applied policy, for ``/ready`` and the audit document."""
    return {
        "content-security-policy": csp,
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "permissions-policy": PERMISSIONS_POLICY,
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "no-store, no-cache, must-revalidate, private",
        "strict-transport-security": (
            f"max-age={hsts_max_age_s}; includeSubDomains" if hsts_max_age_s else "disabled"
        ),
    }
