# N1 — Deployment & Operations

Owner: **N1** (deployment engineer). You receive a merged, audited version from
N2 and are responsible for deploying it and monitoring it in production.

This folder holds the **orchestration layer only** — it deliberately contains no
copy of the application source. The three developer domains (`../P`, `../S`,
`../M`) are built directly from their own folders via the Compose build
contexts, so this folder can never go stale relative to what N2 merged.

---

## Running the stack

```bash
cd N1
docker compose --env-file ../.env up --build
```

**Two flags here are load-bearing, not style:**

- **`--env-file ../.env` is mandatory.** Compose resolves `${VAR}` interpolation
  from a `.env` in the compose file's own directory. The real secrets file lives
  once at the repo root and is deliberately *not* duplicated into `N1/` — a
  second copy of a secrets file is a leak waiting to happen. Omit this flag and
  every `${VAR:?...}` guard in the compose file fires.
- **`name: n2psm` inside `docker-compose.yml` is deliberate.** Compose otherwise
  derives the project name from the containing directory, which would make image
  tags depend on what the checkout happens to be called. Pinning it keeps
  `n2psm-<service>:latest` stable — which `deploy-with-rollback.sh` relies on to
  locate its backup images. Do not remove that key.

> **Why the folder is `NsquaredPSM` and not `N^2PSM`:** it briefly was the
> latter, and it broke the entire toolchain. npm runs scripts through cmd.exe,
> which treats `^` as an escape character and silently strips it — every
> `npm test` and `npm run build` across all three domains resolved to a
> nonexistent `E:\N2PSM\...` path. The project is still named **N²PSM**
> everywhere it is written; only the directory avoids the symbol. Please don't
> rename it back.

Self-healing deploy with automatic rollback on a failed health check:

```bash
cd N1
bash scripts/deploy-with-rollback.sh
```

It tags the current images as `n2psm-<service>:pre-deploy-backup` before
rebuilding, polls each service's real `/health`, and re-tags + restarts the
last known-good image if any watched service fails within 60s.

## What comes up

| Port | Service | Source |
|---|---|---|
| 5000 | Backend API | `../P/backend-api` |
| 8000 | AI verification service | `../M/ai-service` |
| 8443 | TLS/PQC reverse proxy (fronts :5000) | `infra/tls-proxy` |
| 27017 | MongoDB — offline-dev fallback only; production uses Atlas via `MONGODB_URI` | image |
| 9000 / 9001 | MinIO object store / console | image |
| 6379 | Redis — distributed rate limiting + incident blocklist | image |

The mobile client (`../P/mobile-client`) and web console (`../S/web-dashboard`)
are **not containerized here** — they build to static assets and deploy
separately. See their own READMEs.

Health verification after any deploy:

```bash
curl -fsS  http://localhost:5000/health
curl -fsS  http://localhost:8000/health
curl -fsSk https://localhost:8443/health
```

## Configuration

Secrets are **not** stored in this folder. Templates live with what they
configure:

| Template | Scope |
|---|---|
| `../.env.example` | Compose-level superset — the 12 vars the stack itself needs (crypto keys, JWT secrets, Atlas URI, MinIO creds) |
| `../M/ai-service/.env.example` | 43 vars — KMS/key provider, S3/SSE-KMS, model paths, decision thresholds, replay/nonce windows, security headers |
| `../P/backend-api/.env.example` | 17 vars — runtime, DB, JWT algorithm/TTLs, bcrypt rounds, CORS allowlists, AI service URL |
| `../S/web-dashboard/.env.example` | 6 vars — API/socket URLs, map tiles, app version |
| `../P/mobile-client/.env.example` | 2 vars — API base URL, mock-backend toggle |

These are disjoint slices, not duplicates. Copy `../.env.example` to `../.env`
and fill it before the first run.

## Model weights — required, and not in git

The AI service needs two ONNX files that are **gitignored and therefore absent
from any fresh clone**. A deploy will fail at model load without them. See
[`models/FETCH.md`](models/FETCH.md).

## Operational references

Rather than copy these (they belong to their domains and would drift), the
authoritative runbooks are:

- `../M/ai-service/docs/RUNBOOK.md` — AI service operations
- `../M/ai-service/docs/AWS.md` — AWS deployment topology
- `../M/ai-service/docs/HANDOVER.md` — service handover notes
- `../M/ai-service/docs/SECURITY.md`, `docs/OWASP.md` — security posture
- `../S/web-dashboard/aws/DEPLOYMENT.md` — dashboard/CloudFront deployment
- `../S/web-dashboard/docs/07-SETUP-AND-RUNBOOK.md` — dashboard runbook
- `../N2/SETUP.md` — full local stack bring-up

## Current deployed state

See [`STATUS.md`](STATUS.md) — N2 updates it with each merged handoff.
