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
4. **Review a flagged item.** If step 3 produced a `flagged` decision (a synthetic/
   placeholder reference photo won't match a synthetic/placeholder check-in selfie well
   enough for a confident `approved` — expected, not a bug, see ROADMAP.md's scope note
   on calibration), approve or reject it from the dashboard's review queue and confirm
   the `AttendanceLog` status updates.

### What this environment could not itself verify

This step was written and the compose file was checked line-by-line against every
service's actual `config/env.ts` / `app/config.py` for variable-name correctness, but
**could not be run end-to-end in the environment this project was built in** — no Docker
Desktop / Docker Engine was available there (confirmed: `docker --version` reports
"command not found"). Treat the four containerized services and this walkthrough as
code-complete and configuration-verified by inspection, not as live-tested, until
someone runs it on a machine with Docker installed. Every non-Docker piece of this
project (all four quadrants' own test suites, typecheck, lint, build, and — for Person 1
and Person 2 — live browser verification) *was* actually run, repeatedly, in that
environment; this is the one exception, and it is the one exception for a concrete,
checkable reason (a missing binary), not a shortcut.
