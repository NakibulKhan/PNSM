# Deployment status — current handoff

**Maintained by N2.** Updated with each merged version handed to N1. N1 should
treat the version named here as the one authorized for deployment.

---

## Current version

| | |
|---|---|
| **Commit** | `1b03d8d` |
| **Branch** | `main` |
| **Handoff date** | 2026-09-12 |
| **Status** | ⚠️ **Not yet cleared for deployment** — see below |

## Not yet cleared — why

This version is the N²PSM restructure itself (4 quadrants reorganized into 3
developer domains plus N1/N2). The application code is unchanged from the
previously verified state, but the following must pass in the new layout before
N1 deploys anything:

- [ ] Per-domain build + test suites green in their new paths
- [ ] `bash ../N2/scripts/audit-gate.sh` — 0 high/critical vulnerabilities
- [ ] `docker compose --env-file ../.env config` resolves
- [ ] Full stack up, all three `/health` endpoints responding
- [ ] ONNX weights present and hash-verified (see `models/FETCH.md`)

N2 will flip this section to cleared once the gate passes.

## Expected test baselines

Use these to confirm nothing was lost in a deploy or a rebuild — a *lower*
count means something didn't run, which is easy to miss:

| Domain | Suite | Expected |
|---|---|---|
| P / mobile-client | vitest | 95 tests |
| P / backend-api | jest | 159 tests |
| S / web-dashboard | vitest | 105 tests |
| S / web-dashboard | Playwright e2e | 7 tests |
| M / ai-service | pytest | 420 tests |

## Known operational constraints

- **Model weights are not in git.** Any fresh clone needs
  `python scripts/fetch_models.py` before the AI service will start. See
  `models/FETCH.md`.
- **The Python venv is path-bound** and is never copied between machines or
  drives — recreate it locally (`pip install -r requirements-dev.txt`).
  `audit-gate.sh` hard-requires it at `M/ai-service/.venv/`.
- **`--env-file ../.env` is required on every compose invocation** — the
  secrets file is not duplicated into `N1/`. See `OPERATIONS.md`.
- **Production database is MongoDB Atlas** via `MONGODB_URI`. The `mongo`
  container in the compose file is an offline-development fallback that
  production does not use.
- **CI workflows are not yet active.** Two workflow files exist
  (`S/web-dashboard/.github/workflows/ci.yml`,
  `M/ai-service/.github/workflows/ci.yml`) but GitHub only reads
  `.github/workflows` at the repository root, so neither has ever executed.
  Hoisting them is tracked as follow-up work — until then, treat the
  verification commands above as manual gates.

## Rollback

`scripts/deploy-with-rollback.sh` handles this automatically on a failed health
check. To roll back manually, the previous images are tagged
`n2psm-<service>:pre-deploy-backup` until the next successful deploy removes
them.
