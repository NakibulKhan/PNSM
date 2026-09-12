#!/usr/bin/env bash
# Local self-healing deploy (Item 3d, Ultra blueprint) — the real, no-AWS
# analog of an autonomous CI/CD rollback pipeline. Wraps `docker compose up
# --build`, not a replacement for it: on any watched service failing its
# real /health endpoint after a rebuild, this re-tags and restarts the
# previous, known-good image instead of leaving the broken build running.
#
# Pure Docker Compose — needs no CI runner or cloud build service, which is
# what makes it usable as the on-prem deploy path and as a rehearsal for the
# hosted one. Owned by N1 (deployment).
set -uo pipefail

# Resolves to N1/ — where docker-compose.yml lives after the N²PSM
# restructure. The secrets file is deliberately NOT duplicated into N1; it
# stays once at the repo root, hence --env-file ../.env on every compose call.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Services this script watches and can roll back. Each must have a real
# /health endpoint reachable on localhost at the given port (all three
# already do, unmodified — this script adds no new endpoints).
declare -A HEALTH_URLS=(
  [backend]="http://localhost:5000/health"
  [ai-service]="http://localhost:8000/health"
  [tls-proxy]="https://localhost:8443/health"
)
HEALTH_TIMEOUT_S=60
HEALTH_INTERVAL_S=3

declare -A HAS_BACKUP

# A raw image ID alone is not a safe rollback handle on every Docker install:
# live-testing this script (deliberately breaking `backend`'s PORT and
# re-running) found that this host's image store does not reliably keep a
# same-tag rebuild's *previous* image retrievable by ID once `docker compose
# up --build` replaces the `:latest` tag — `docker tag <old-id> ...` failed
# with "No such image" immediately after the rebuild, even though nothing
# had explicitly deleted it. A second, independently-held tag reference
# (created *before* the rebuild) survives that in a way a bare content ID
# does not, so that is the real rollback handle this script uses.
echo "== tagging current images as rollback backups =="
for service in "${!HEALTH_URLS[@]}"; do
  target_tag="n2psm-${service}:latest"
  backup_tag="n2psm-${service}:pre-deploy-backup"
  if docker tag "$target_tag" "$backup_tag" 2>/dev/null; then
    HAS_BACKUP["$service"]=1
    echo "  $service -> $backup_tag"
  else
    HAS_BACKUP["$service"]=0
    echo "  $service -> (not currently running; nothing to roll back to)"
  fi
done

echo
echo "== docker compose up -d --build =="
docker compose --env-file ../.env up -d --build

curl_check() {
  local url="$1"
  if [[ "$url" == https://* ]]; then
    curl -fsSk "$url" >/dev/null 2>&1
  else
    curl -fsS "$url" >/dev/null 2>&1
  fi
}

echo
echo "== waiting up to ${HEALTH_TIMEOUT_S}s per service for a real /health 200 =="
FAILED_SERVICES=()
for service in "${!HEALTH_URLS[@]}"; do
  url="${HEALTH_URLS[$service]}"
  elapsed=0
  ok=0
  while [ "$elapsed" -lt "$HEALTH_TIMEOUT_S" ]; do
    if curl_check "$url"; then
      ok=1
      break
    fi
    sleep "$HEALTH_INTERVAL_S"
    elapsed=$((elapsed + HEALTH_INTERVAL_S))
  done
  if [ "$ok" -eq 1 ]; then
    echo "  $service: healthy ($url)"
  else
    echo "  $service: FAILED health check after ${HEALTH_TIMEOUT_S}s ($url)"
    FAILED_SERVICES+=("$service")
  fi
done

if [ "${#FAILED_SERVICES[@]}" -eq 0 ]; then
  echo
  echo "== deploy succeeded: removing rollback backup tags =="
  for service in "${!HEALTH_URLS[@]}"; do
    [ "${HAS_BACKUP[$service]:-0}" -eq 1 ] && docker rmi "n2psm-${service}:pre-deploy-backup" >/dev/null 2>&1
  done
  echo "deploy-with-rollback: all watched services healthy. Nothing to roll back."
  exit 0
fi

echo
echo "== rolling back: ${FAILED_SERVICES[*]} =="
for service in "${FAILED_SERVICES[@]}"; do
  target_tag="n2psm-${service}:latest"
  backup_tag="n2psm-${service}:pre-deploy-backup"
  if [ "${HAS_BACKUP[$service]:-0}" -ne 1 ]; then
    echo "  $service: no previous image recorded — cannot roll back automatically. Investigate manually."
    continue
  fi
  echo "  $service: re-tagging $backup_tag -> $target_tag and restarting"
  docker tag "$backup_tag" "$target_tag"
  docker compose --env-file ../.env up -d --no-build "$service"
done

echo
echo "== diagnostic summary (the local equivalent of the dispatched alert — no chat/paging integration exists here) =="
echo "Rolled back: ${FAILED_SERVICES[*]}"
echo "Re-check with: curl -fsS http://localhost:5000/health ; curl -fsS http://localhost:8000/health ; curl -fsSk https://localhost:8443/health"
exit 1
