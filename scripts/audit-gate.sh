#!/usr/bin/env bash
# Local supply-chain audit gate (Item 4, Flawless/Ultra blueprint).
# Not a GitHub Action — this project stays local-only and unpushed. Run
# before considering a dependency change "done": exits non-zero the moment
# any quadrant reports a high/critical vulnerability, so a real problem is
# never silently left for later.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

check_node_quadrant() {
  local name="$1" dir="$2"
  echo "== $name (npm audit --omit=dev --audit-level=high) =="
  if ! (cd "$ROOT_DIR/$dir" && npm audit --omit=dev --audit-level=high); then
    echo "FAILED: $name has a high/critical vulnerability."
    FAILED=1
  fi
  echo
}

check_node_quadrant "Person1_MobileClient" "Person1_MobileClient"
check_node_quadrant "Person2_WebDashboard" "Person2_WebDashboard"
check_node_quadrant "Person3_BackendAPI" "Person3_BackendAPI"

echo "== Person4_AIBiometricService (pip-audit) =="
AI_DIR="$ROOT_DIR/Person4_AIBiometricService"
if [ -x "$AI_DIR/.venv/Scripts/python.exe" ]; then
  PY="$AI_DIR/.venv/Scripts/python.exe"      # Windows venv layout
elif [ -x "$AI_DIR/.venv/bin/python" ]; then
  PY="$AI_DIR/.venv/bin/python"              # POSIX venv layout
else
  echo "FAILED: no .venv found under Person4_AIBiometricService — run its setup first."
  PY=""
  FAILED=1
fi
if [ -n "$PY" ] && ! (cd "$AI_DIR" && "$PY" -m pip_audit); then
  echo "FAILED: Person4_AIBiometricService has a reported vulnerability."
  FAILED=1
fi
echo

if [ "$FAILED" -ne 0 ]; then
  echo "audit-gate: FAILED — see above."
  exit 1
fi
echo "audit-gate: all four quadrants clean."
