# Running the whole stack locally

ROADMAP.md Phase 5. This is the one place that wires all four quadrants together —
read [`DECISIONS.md`](./DECISIONS.md) first if anything here looks surprising, most of
it exists because of a specific resolved conflict there.

## 1. One-time setup

```bash
cp .env.example .env
```

The committed `.env.example` already has real, freshly-generated dev secrets in it (see
its own header comment for why that's fine here and nowhere else in this repo). No
editing required for a first run.

### The one manual step: a hosts-file entry

Person 4's AI service both **mints** presigned MinIO upload/download URLs (which a
browser or the Capacitor WebView on your host machine has to open) and **fetches
objects back out of the bucket itself** (during `/v1/verify`, running inside the
compose network). Both callers have to reach MinIO through the exact same hostname —
`minio` — for a presigned URL's signature to still be valid wherever it's opened. Docker
already resolves `minio` correctly for every container in this project; your host
machine's browser does not, by default. Add one line:

**Windows** (PowerShell, run as Administrator):
```powershell
Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "127.0.0.1 minio"
```

**macOS / Linux:**
```bash
echo "127.0.0.1 minio" | sudo tee -a /etc/hosts
```

Skipping this doesn't break login, enrolment metadata, or the check-in decision itself
— only two things need it: the mobile client's own presigned-PUT selfie upload, and
opening a selfie from the HR audit view. Everything else works without it.

## 2. Start the containerized services

```bash
docker compose up --build
```

Brings up, in dependency order: `mongo` → `minio` → `minio-init` (creates the
`pnsm-selfies` bucket, then exits — that's expected, it's a one-shot job, not a crash)
→ `ai-service` → `backend`. First run downloads the `mongo:7` and `minio/minio` images
and builds the two application images (the AI service image bakes in the ONNX model
weights and calibration file, so expect the first build to take a few minutes).

Check everything is up:
- Backend: `curl http://localhost:5000/health`
- AI service: `curl http://localhost:8000/health` and `curl http://localhost:8000/ready`
- MinIO console: http://localhost:9001 (login with the `MINIO_ROOT_USER`/`PASSWORD` from `.env`)

### Bootstrap the first Super Admin

A fresh database has no accounts and no way to create one through the app itself:
admin accounts are created by an existing admin (by design), and mobile employee
accounts are created by an admin console user — so a genuinely empty database is a
chicken-and-egg problem the API alone can't resolve. `Person3_BackendAPI/src/scripts/
seed.ts` is the one way in, run directly against the database instead of through the
API (DECISIONS.md N18). It's idempotent — safe to run again later, it does nothing if
a Super Admin already exists:

```bash
docker compose exec backend node dist/scripts/seed.js
```

Prints the generated login once:

```
Super Admin account created.
  email:    admin@pnsm.local
  password: <a random one, shown only this once>
This password is shown once. Store it securely and change it after first login.
Roles ready: Super Admin, Admin, Employee.
```

Sign in with that email/password, then change the password from the console. Set
`PNSM_SEED_ADMIN_EMAIL` and/or `PNSM_SEED_ADMIN_PASSWORD` (as extra `-e` flags on the
`docker compose exec` call above) to choose your own instead of the generated default.

Running this outside the container (`npm run seed` from `Person3_BackendAPI/`, e.g.
for local dev without Docker) needs the same required env vars the server itself
does — `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — since the script
imports the app's shared `config/env.ts`, which validates all of them eagerly at
import time regardless of which ones the script itself actually uses.

## 3. Start Person 1 and Person 2 on the host

These are **not** in `docker-compose.yml` — ROADMAP.md's own Phase 5 scope keeps them on
their native dev servers, pointed at the composed backend on `:5000`.

```bash
# Terminal A
cd Person2_WebDashboard
cp .env.example .env.local   # then set VITE_DEMO_MODE=0
npm run dev                  # http://localhost:3000

# Terminal B
cd Person1_MobileClient
cp .env.example .env.local   # then set VITE_MOCK_BACKEND=false
npm run dev                  # http://localhost:5173
```

Both `.env.example` files already default `VITE_API_BASE_URL` to `http://localhost:5000`
(mobile) / `http://localhost:5000/api` (web) — matching this compose file's published
backend port, no edits needed there.

## 4. Manual end-to-end pass

With all five processes running (four containers + whichever of the two dev servers
you're testing):

1. **Enrol an employee.** Log into the web dashboard as an admin, create an employee,
   upload a reference photo through the presigned-upload flow (this is what exercises
   the hosts-file fix from step 1 — if it hangs or 403s, that's the symptom). Confirm the
   photo lands in the `pnsm-selfies` bucket via the MinIO console.
2. **Check in from the mobile client.** Log in as that employee, submit a check-in
   (selfie + PIN + location) from inside a geofence tied to that employee's office.
3. **Watch it land live.** The web dashboard's live feed should show the check-in via
   Socket.IO within a second or two of step 2 completing, with a decision of `approved`
   or `flagged` (not silently defaulted to a two-band `rejected` — that would mean
   `PNSM_DECISION_BANDS=three` isn't actually reaching the AI service; check `docker
   compose logs ai-service`).
4. **Review a flagged item.** If step 3 produced a `flagged` decision, approve or
   reject it from the dashboard's review queue and confirm the `AttendanceLog` status
   updates. Note that AI-generated (StyleGAN2) test photos tend to land at the extremes
   — a self-match check-in scores ~100% (`approved`), a genuinely different synthetic
   identity scores in the low single digits (`rejected`, with no `AttendanceLog`
   written at all — that's Person 4's documented design, not a bug: see
   DECISIONS.md N17's note). Landing a real `flagged` result needs a photo pair
   similar enough to fall between the 60/85 bands, which two independently-generated
   synthetic faces won't reliably do — real employee photos will.

### This has been run live, end to end — see DECISIONS.md N10-N18

This whole walkthrough, including the bootstrap step above, was executed for real
against the actual running stack (ROADMAP.md Phase 5) — not just checked by
inspection. Doing so found and fixed **eight real, previously-invisible bugs**, one of
them severe enough that the mobile app had never successfully reached this backend at
any point before (N15 — a router-mounting order bug that silently swallowed the
entire `/api/mobile/*` family behind admin's auth gate) — and closed a ninth gap, the
missing bootstrap path itself (N18, the seed script above). None of the eight bugs
were catchable by any test that existed before this pass, because no test in any
quadrant had ever driven a real cross-service HTTP call before. Full details, root
causes, and fixes are in [`DECISIONS.md`](./DECISIONS.md)'s N10-N18 entries — read those before
assuming any part of this pipeline "just works" without checking DECISIONS.md first.
