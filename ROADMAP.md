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

Task list below reflects the real contracts discovered by reading Person 4's actual
`API.md`/`INTEGRATION.md`/client and Person 1's/Person 2's actual code — see
`DECISIONS.md` N1–N7 for the reasoning behind each.

- [x] Update `README.md`'s broken doc references to point at `DECISIONS.md`/`ROADMAP.md`
- [x] AI service client: ported Person 4's `clients/node/pnsmAiClient.js` to `src/services/aiClient/pnsmAiClient.ts` (HMAC signing, `embed`/`verify`/`hashPin`/`verifyPin`/`presignPut`/`presignGet`) — `DECISIONS.md` N1
- [x] Env additions: `PNSM_AI_URL`, `PNSM_HMAC_SECRET`
- [x] `docker-compose.yml`: added a MinIO service alongside `mongo` — `DECISIONS.md` N7
- [x] Mobile auth: `POST /api/mobile/auth/login` (`employee_code`+password), `/refresh`, `/logout` — `DECISIONS.md` N3
- [x] `GET /api/mobile/me` — profile + assigned office/geofence + shift + recent history — `DECISIONS.md` N4
- [x] Check-in pipeline: `POST /api/mobile/attendance/checkin` — PIN verify via AI client → geofence check (existing `geofenceService`) → face verify via AI client → `AttendanceLog` write → Socket.IO emit, following Person 4's exact 6-step sequence and error-code table — `DECISIONS.md` N1, N2, N5. Also corrected `FaceEmbedding`'s schema to match Person 4's real opaque `envelope` shape (`DECISIONS.md` N8), found while wiring this up.
- [x] `POST /api/mobile/attendance/anomaly` — spoofing anomaly reports from the mobile client
- [x] `POST /api/mobile/heartbeat` — rate-limited, capped/TTL collection (new `Heartbeat` model, 24h TTL index) — `DECISIONS.md` B7
- [x] Presign proxy routes (admin `POST /api/uploads/presign`, mobile `POST /api/mobile/uploads/presign`) — thin pass-through to the AI client's `presignPut`/`presignGet`, no image bytes touch this server — `DECISIONS.md` N2
- [x] Employee routes: `GET /employees`, `POST /employees` (incl. PIN generation via AI client + `Shift` creation via new `parseWeekLabel`), `GET/PATCH /employees/:id`, `PATCH /employees/:id/photo`, `DELETE /employees/:id` (soft) — `DECISIONS.md` N6
- [x] Office + geofence routes: `GET /offices`, `GET/POST/PATCH/DELETE /geofences`
- [x] Attendance routes: `GET /attendance`, `GET /attendance/feed`, `GET /attendance/live-map`, `GET /attendance/:id/selfie-url`, `POST /attendance/:id/approve|reject`
- [x] Leave routes: `GET /leave`, `POST /leave/:id/approve|reject`
- [x] Dashboard routes: `GET /dashboard/kpis`, `GET /dashboard/trend`
- [x] Super-Admin routes: `GET /admins`, `GET /audit`, `GET /spoof-alerts`, `GET /billing`, `GET/PATCH /policy`
- [x] Socket.IO: wired real emission of `attendance:new`, `attendance:flagged`, `spoof:alert`, `notification:new` from the routes above (emitters existed since Phase 1 scaffolding, unused until now)
- [x] First real `npm install && npm run build && npm test` run — surfaced and fixed 4 pre-existing bugs never caught before (the scaffold had never actually been run): `jest.config.js`/`tsconfig.json` `rootDir` conflict that failed every single test suite at collection (fixed with a dedicated `tsconfig.jest.json`), a Socket.IO `data` property module-augmentation that can't type-check (fixed using Socket.IO's own generic parameters instead), an `authService.ts` type omitting `reference_photo_url`'s possible `undefined`, and an integration test sending a 5-character password that failed schema validation before it could exercise the case it was testing. Added 18 new tests (11 for the check-in pipeline's success/rejection paths, 7 for `parseWeekLabel`'s round-trip with `deriveWeekLabel`) — full suite is 133/133 passing, clean typecheck, clean build.

**Not done in this phase, by design:** actual native-device fields for `is_emulator`/`is_rooted` detection (Person 1, Phase 3), wiring Person 2's dashboard/Person 1's mobile client to these real endpoints (Phases 3-4), running this against a real MongoDB/MinIO instance rather than mocks (Phase 5 integration pass — the test suite mocks the persistence layer throughout, same scope choice the original Phase-1 auth tests made).

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
