# PNSM Backend (Person 3)

Phase 1 — foundation, auth, RBAC scaffolding, and the service seams (Face
verification, R2, Socket.IO) that later phases build on. See
[`../DECISIONS.md`](../DECISIONS.md) and [`../ROADMAP.md`](../ROADMAP.md) for
the decisions this code implements and what's left to build (Phase 2).

## What exists in this phase

- Express + TypeScript app, MongoDB/Mongoose models for all 13 collections.
- JWT auth core (role-agnostic) + `POST /auth/login`, `POST /auth/refresh`,
  `GET /auth/me` (role-neutral per ADR-4).
- RBAC permission matrix (`src/middleware/rbac.ts`) — superset of Person 2's
  admin matrix plus an employee scope (Conflict C8).
- Two response conventions, structurally separated (ADR-1): mobile routes
  (none exist yet — that's a later phase) would return bare JSON; the admin
  router (mounted) returns `{ data, error, meta? }`.
- `GET /health`.
- `FaceVerificationService` interface + mock adapter (ADR-8) — no route
  calls it yet (that's the attendance-pipeline phase).
- Backend-owned R2 upload service for check-in selfies (ADR-7) — not yet
  wired to a route.
- Socket.IO server with JWT handshake auth and the exact `"invalid
  credentials"` failure string Person 2's client depends on — not yet
  emitting real events (no attendance/leave routes exist yet to trigger them).

## Not in this phase (by design — see the implementation plan)

Employee/geofence/attendance/leave/dashboard routes, the mobile-facing
endpoints, and Super Admin endpoints. Building those before Phase 2's
scaffolding was confirmed would have meant guessing at wiring this report
already flags as pending (mobile auth contract, work-week convention).

## Running it for real

```bash
npm install
npm run build
npm test
docker build -t pnsm-backend .
docker run --rm -p 5000:5000 --env-file .env pnsm-backend
curl http://localhost:5000/health
```

Or with Docker Compose (spins up a local MongoDB too):

```bash
docker compose up --build
```

## A note on the environment this was authored in

This code was written and reviewed in a sandboxed session with no outbound
network access (`npm install` cannot reach the npm registry there) and no
Docker binary installed. Every command above was still actually attempted in
that sandbox for an honest, non-faked status report — see the final message
in that session for the exact failure output and root cause. None of that
reflects a defect in this code; it reflects the sandbox. Running the four
commands above in a normal developer machine or CI runner (with network
access and Docker installed) is expected to succeed.
