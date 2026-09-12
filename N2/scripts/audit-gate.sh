#!/usr/bin/env bash
# Supply-chain audit gate. Owned by N2 (audit + merge).
#
# Run before accepting a domain's dependency change as "done": exits non-zero
# the moment any domain reports a high/critical vulnerability, so a real
# problem is never silently left for later.
#
# Paths follow the N²PSM domain layout — this script lives in N2/scripts/, so
# the repo root (where P/, S/, M/ sit) is two levels up, not one.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAILED=0

check_node_project() {
  local name="$1" dir="$2"
  echo "== $name (npm audit --omit=dev --audit-level=high) =="
  if [ ! -d "$ROOT_DIR/$dir" ]; then
    echo "FAILED: $dir not found under $ROOT_DIR — layout drift?"
    FAILED=1
    echo
    return
  fi
  if ! (cd "$ROOT_DIR/$dir" && npm audit --omit=dev --audit-level=high); then
    echo "FAILED: $name has a high/critical vulnerability."
    FAILED=1
  fi
  echo
}

# Domain A — capture path (two npm projects under one owner)
check_node_project "P / mobile-client" "P/mobile-client"
check_node_project "P / backend-api"   "P/backend-api"
# Domain B — web console
check_node_project "S / web-dashboard" "S/web-dashboard"

# Domain C — AI verification (Python)
echo "== M / ai-service (pip-audit) =="
AI_DIR="$ROOT_DIR/M/ai-service"
if [ -x "$AI_DIR/.venv/Scripts/python.exe" ]; then
  PY="$AI_DIR/.venv/Scripts/python.exe"      # Windows venv layout
elif [ -x "$AI_DIR/.venv/bin/python" ]; then
  PY="$AI_DIR/.venv/bin/python"              # POSIX venv layout
else
  echo "FAILED: no .venv found under M/ai-service — run its setup first."
  echo "        (the venv is intentionally not copied between machines; it is"
  echo "         path-bound. Recreate it locally, see M/ai-service/README.md.)"
  PY=""
  FAILED=1
fi
if [ -n "$PY" ] && ! (cd "$AI_DIR" && "$PY" -m pip_audit); then
  echo "FAILED: M/ai-service has a reported vulnerability."
  FAILED=1
fi
echo

if [ "$FAILED" -ne 0 ]; then
  echo "audit-gate: FAILED — see above."
  exit 1
fi
echo "audit-gate: all three domains clean."
