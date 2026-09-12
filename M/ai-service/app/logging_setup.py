"""Structured logging with secret redaction.

PINs, keys and signatures must never reach a log line, a trace, or an error
payload.  Relying on every future ``log.info`` call to remember that is not a
control; a filter on the root logger is.

Reference: blueprint section 06 (log redaction).
"""

from __future__ import annotations

import json
import logging
import re
import sys
from typing import Any, Final

#: Patterns are matched against the *formatted* message, so they catch both
#: f-strings and %-style arguments regardless of how a caller built the line.
_REDACTIONS: Final[tuple[tuple[re.Pattern[str], str], ...]] = (
    (re.compile(r'("?\b(?:pin|pin_hash|pepper|secret|password|token|api_key|access_key)"?\s*[:=]\s*"?)([^\s",;}]+)', re.I), r"\1[REDACTED]"),
    (re.compile(r"\bpin=\S+", re.I), "pin=[REDACTED]"),
    (re.compile(r"\bv1=[0-9a-f]{16,}", re.I), "v1=[REDACTED]"),
    (re.compile(r"\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}"), "[BCRYPT_HASH]"),
)


class RedactionFilter(logging.Filter):
    """Scrub secrets from every record before a handler sees it."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - a broken format string
            return True
        scrubbed = message
        for pattern, replacement in _REDACTIONS:
            scrubbed = pattern.sub(replacement, scrubbed)
        if scrubbed != message:
            record.msg = scrubbed
            record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line -- greppable in a platform log viewer."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key in ("request_id", "user_ref", "reason_code"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(level: str = "INFO", *, json_output: bool = True) -> None:
    """Install the root handler. Idempotent."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter()
        if json_output
        else logging.Formatter("%(asctime)s %(levelname)-7s %(name)s | %(message)s")
    )
    handler.addFilter(RedactionFilter())
    root.addHandler(handler)

    # Access logs duplicate what the app already records, and uvicorn's are not
    # redacted by our filter because they are emitted before the app sees them.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
