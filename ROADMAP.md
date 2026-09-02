# Roadmap — Path to Local Dev-Complete

This tracks everything left to get PNSM running end-to-end on one machine: mobile client,
web dashboard, backend API, and AI biometric service all talking to each other via
localhost/docker-compose. Real cloud accounts, real native app builds, and real biometric
calibration photos are out of scope for this phase (see `DECISIONS.md` B3/B4) — those get
their own roadmap once local dev-complete is reached.

Every item is labeled by the quadrant (`PersonN`) that owns it, the same way it would be if
four real people were doing this work, so progress stays traceable per quadrant. Status:
`[ ]` not started, `[~]` in progress, `[x]` done.

**Build order and why:** Backend first — Mobile, Web, and the AI service all consume
contracts that only Backend defines, and today only auth+health routes exist. AI-service
config comes next since Backend's check-in pipeline calls it directly. Mobile and Web can
then proceed in parallel once Backend's routes exist. Integration testing comes last.

## Phase 1 — Person 3: Backend API (blocks everything else)

- [ ] Local infra: docker-compose service definitions for MongoDB + MinIO (S3-compatible), env vars pointed at them instead of Atlas/AWS (per `DECISIONS.md` B3/B4)
- [ ] Check-in pipeline: `POST /attendance/check-in` — geofence validation (`$geoWithin`/`$centerSphere`), calls Person 4's AI service (HMAC-signed request per its `INTEGRATION.md`), records `AttendanceLog` with `flagged`/`approved`/`rejected` per `DECISIONS.md` B2
- [ ] Employee routes (CRUD, onboarding)
- [ ] Geofence routes (CRUD, tied to `Office`)
- [ ] Attendance routes (list/filter/detail — feeds Person 2's dashboard)
- [ ] Leave routes (request/approve/reject, `LeaveBalance`)
- [ ] Dashboard/analytics routes (KPIs, trends)
- [ ] Super-Admin routes (admins, audit, billing, policy)
- [ ] Mobile-specific routes matching Person 1's expected contract (profile, home data)
- [ ] `POST /mobile/heartbeat` — rate-limited, capped/TTL collection (`DECISIONS.md` B7)
- [ ] Socket.IO: actually emit `attendance:new`, `attendance:flagged`, `spoof:alert`, `notification:new` (currently handshake only, no real emission)
- [ ] Wire the storage service to real upload routes (service exists, not yet wired to a route)
- [ ] First real `npm install && npm run build && npm test` run — fix whatever surfaces (never run before in the authoring sandbox)
- [ ] Update `README.md`'s broken doc references to point at `DECISIONS.md`/`ROADMAP.md` (per `DECISIONS.md`)

## Phase 2 — Person 4: AI Biometric Service

- [ ] Set `PNSM_DECISION_BANDS=three` as the default local config (`DECISIONS.md` B2)
- [ ] docker-compose service definition alongside backend + Mongo + MinIO
- [ ] Confirm/implement HMAC request-signature verification matching Person 3's calls
- [ ] Real calibration is out of scope (no real employee photos available) — keep the bootstrap `calibration.json`, but make its "uncalibrated" status visible at runtime (e.g., a startup log warning) rather than silent
- [ ] Model weights: `models/` currently has no downloaded ONNX weights — decide and implement either (a) fetch real weights now if feasible offline-free, or (b) a documented stub/mock inference mode so the check-in pipeline is testable end-to-end without them
- [ ] First real `pytest`/`scripts/verify_offline.py` run with actual dependencies installed (389 tests reportedly pass via the dependency-free fallback only; `tests/api/test_routes.py` and `tests/contract/test_openapi.py` need FastAPI actually installed and have never run)
- [ ] Generate `docs/openapi.json`
- [ ] Wire the presigned MinIO/S3 upload flow for enrollment photos

## Phase 3 — Person 1: Mobile Edge Client (parallel with Phase 4)

- [ ] Point `src/lib/http.js`/`api.js` at the real local backend base URL
- [ ] Verify raw-PIN flow end-to-end against the real backend (`DECISIONS.md` PIN decision)
- [ ] Verify refresh-token handling reads the response body correctly (`DECISIONS.md` B1)
- [ ] Get the check-in flow working against the real backend + AI service via Capacitor's browser/dev-server preview (no real native build this phase)
- [ ] First real `npm test` run (never run in the authoring sandbox — no registry access)
- [ ] Wire the 15s heartbeat to call the new `POST /mobile/heartbeat` (`DECISIONS.md` B7)
- [ ] **Explicitly out of scope this phase:** native anti-mock-location checks, Android foreground service, iOS background location — all need a real native build (Android Studio/Xcode), which is outside "local dev-complete." Flagged for the deployment phase.

## Phase 4 — Person 2: Web Command Center (parallel with Phase 3)

- [ ] Switch off `VITE_DEMO_MODE`, point at the real local backend
- [ ] Verify the live Socket.IO feed against Person 3's real event emission
- [ ] Verify geofence manager writes real geofence data via the real API
- [ ] Verify the flagged/review queue works against real flagged check-ins
- [ ] Run the existing Vitest suite against the real API, fix any breakage
- [ ] Verify RBAC gating against real JWT roles from the backend

## Phase 5 — Integration

- [ ] Root-level `docker-compose.yml` orchestrating Mongo + MinIO + backend + AI service (web dashboard and mobile client run via their own `npm run dev`, pointed at the composed backend)
- [ ] Root `.env.example`/setup doc explaining how the four services' env vars connect
- [ ] End-to-end manual pass: enroll a face (synthetic/placeholder images, since real calibration is out of scope), check in via the mobile web client, see it land on the dashboard's live feed, approve/reject a flagged item from the review queue
