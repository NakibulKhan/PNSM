# Deployment status — current handoff

**Maintained by N2.** Updated with each merged version handed to N1. N1 should
treat the version named here as the one authorized for deployment.

---

## Current version

| | |
|---|---|
| **Commit** | `93b50cc` (+ doc fixes) |
| **Branch** | `main` |
| **Handoff date** | 2026-09-12 |
| **Status** | ⚠️ **Restructure verified — blocked on one critical CVE** |

## Restructure verification — complete

Every domain was rebuilt from scratch at the new path and re-verified:

| Check | Result |
|---|---|
| P / mobile-client — vitest | ✅ **95 / 95** |
| P / mobile-client — build | ✅ built |
| P / mobile-client — capacitor parity | ✅ core all v8 (1 documented exception) |
| P / backend-api — typecheck | ✅ clean |
| P / backend-api — jest | ✅ **159 / 159** |
| S / web-dashboard — verify (typecheck+lint+test+build) | ✅ **105 / 105**, built |
| S / web-dashboard — Playwright e2e | ✅ **7 / 7** |
| M / ai-service — pytest | ✅ **432 / 432** |
| M / ai-service — ruff | ✅ all checks passed |
| M / ai-service — mypy | ✅ no issues, 47 files |
| `docker compose config` | ✅ resolves; project `n2psm`, all 3 build contexts valid |
| ONNX weights | ✅ both hashes match `checksums.txt` |

pytest is 432 rather than the previously-recorded 420 — the slow-marker work
added tests since that baseline was written. Higher is fine; a *lower* count is
the thing to investigate, because it means something silently didn't run.

## 🔴 Blocker — critical CVE in maplibre-gl

`bash ../N2/scripts/audit-gate.sh` fails on one finding. **This is not caused by
the restructure** — it is a newly-published advisory that surfaced when
dependencies were reinstalled from scratch.

**[GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579) —
MapLibre GL JS: XSS sanitizer bypass in `DOM.sanitize()`** (critical).
Installed `maplibre-gl@4.7.1`; affected `<= 6.4.0`; fixed in `6.9.0`.

**It is reachable in our code, not theoretical.**
`S/web-dashboard/src/components/map/live-map.tsx:149` interpolates employee data
straight into a MapLibre popup with no escaping:

```js
new gl.Popup(...).setHTML(
  `<p ...>${entry.employee_name}</p> ... ${entry.employee_code} ...`
)
```

`employee_name` is operator-entered data that round-trips through the database
and back via `/attendance/live-map`. A name containing markup becomes stored XSS
executing inside an authenticated HR / Super Admin session — an
employee-to-admin privilege-escalation path.

**Two fixes are needed, and the second matters more:**

1. Upgrade `maplibre-gl` 4.7.1 → 6.9.0. That is a **two-major-version breaking
   change** touching the geofence editor and the live map, so it needs its own
   change and its own testing — which is exactly why it was not bundled into the
   restructure commit.
2. Stop interpolating unescaped user data into `setHTML()` at all. The library's
   sanitizer is defence-in-depth, not the primary control — escape the values, or
   build the node and assign via `textContent`. **This fix is independent of the
   library version and should land regardless of when the upgrade happens.**

Until both are done, treat the live-map screen as unsafe to expose to
production data with untrusted operator input.

## Remaining before clearance

- [x] Per-domain build + test suites green in their new paths
- [ ] `audit-gate.sh` — 0 high/critical (blocked on the CVE above)
- [x] `docker compose --env-file ../.env config` resolves
- [ ] Full stack up, all three `/health` endpoints responding
- [x] ONNX weights present and hash-verified

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
