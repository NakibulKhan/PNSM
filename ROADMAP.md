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

- [x] Set `PNSM_DECISION_BANDS=three` as the default local config (`DECISIONS.md` B2) — changed in `.env.example` only (not the Python default, which stays a neutral `two` for deployments this decision doesn't cover)
- [x] docker-compose service definition alongside backend + Mongo + MinIO — Person 4's own `docker-compose.yml` already defines `ai-svc` + `mock-api` + `minio` + `minio-init`; unifying it with Person 3's separate `mongo`+`minio` compose file into one root stack is Phase 5's job, not duplicated here
- [x] Confirm/implement HMAC request-signature verification matching Person 3's calls — read `app/crypto/hmac_auth.py` directly: `timestamp + "." + body`, HMAC-SHA256, `v1=` prefix — byte-for-byte identical to the Node client ported in Phase 1. No change needed; confirmed with real signed requests against a live running instance (below)
- [x] Real calibration is out of scope this phase — kept the bootstrap `calibration.json`, added a startup warning (`app/runtime.py`) that fires whenever `measured.provenance` starts with `"BOOTSTRAP"`, both logged and surfaced in `/ready`'s `warnings[]`. Confirmed live: a running instance's `/ready` response includes it.
- [x] Model weights — fetched the real ones: `python scripts/fetch_models.py` succeeded against both public sources (OpenCV Zoo, HuggingFace), checksums recorded and committed. This is option (a), not the stub fallback — the service now runs with genuine ArcFace/YuNet inference, confirmed live (see below).
- [x] First real `pytest`/`scripts/verify_offline.py` run with actual dependencies installed — `pytest`: 420/420 passing (up from 10 failures on the first attempt); `verify_offline.py`: 389/389 passing, matching `HANDOVER.md`'s claim exactly. Also ran `mypy` (clean after 2 fixes) and `ruff check` (clean, no fixes needed) and the real `pip-audit` supply-chain gate (0 findings) and `scripts/provision_aws.py --check` (all deploy templates resolve) — none of these had ever been run for real before either.
- [x] Generate `docs/openapi.json` — done, 11 paths / 23 schemas; `--check` gate passes.
- [x] Wire the presigned MinIO/S3 upload flow for enrollment photos — already fully implemented in `app/services/presign.py`/`app/routers/storage.py` (server-side key construction, TTL from settings, size ceiling); confirmed live with a real signed `presign-put` call producing a correctly-shaped SigV4 URL (no live MinIO available in this environment to test the actual PUT — that needs Docker, deferred to Phase 5).

**Bugs found and fixed by actually running this for the first time** (mirrors Phase 1's experience — nothing here had ever executed against real dependencies before):
1. **Test/model-directory collision.** `build_detector()`/`build_embedder()` correctly prefer a real model file over the stub whenever one exists on disk — but once real weights were downloaded into `models/` (the task above), every test that expected the deterministic `PNSM_ALLOW_STUB_MODELS=true` stub path started hitting the real YuNet detector instead, which correctly rejects the tests' synthetic (non-photographic) frames as `NO_FACE_DETECTED`. Fixed by pointing `PNSM_MODEL_DIR`/`model_dir` at a path that never exists in `tests/conftest.py` and `tests/helpers.py`, so the test suite's stub-vs-real choice no longer depends on incidental filesystem state.
2. **A test asserting 404 sent an unsigned request.** `test_an_unknown_route_returns_a_json_envelope` used the unsigned `raw_client`, but `HmacAuthMiddleware` wraps routing entirely and rejects any unsigned request to a non-exempt path with 401 before Starlette's router can report 404 — the test needed the signed `client` fixture, since it was testing the 404 envelope shape, not auth.
3. **mypy couldn't parse its own dependency's stubs.** `numpy` 2.5.2 (resolved fresh from the unpinned `numpy>=1.26,<3.0` range) ships stub files using PEP 695 `type X = ...` syntax, which mypy's configured `python_version = "3.11"` target refuses to parse — failing on the *dependency's* stub, not on any of this project's own code. Bumped to `"3.12"` (not a floor change; `requires-python` is untouched).
4. **A real, mypy-correct false positive** in `app/ai/detect.py`: the installed `cv2` stubs type `FaceDetectorYN.detect()`'s second return value as always-present, but the real C++ binding does return `None` when no face is found (standard, necessary, already-tested behavior) — annotated with `# type: ignore[unreachable]` and an explanatory comment rather than removing the check.
5. **Every trailing inline `# comment` in `.env.example` silently corrupts its value.** Confirmed directly with `dotenv.dotenv_values()`: `PNSM_KMS_KEY_ID=                    # arn:aws:kms:...` parses to the literal string `"# arn:aws:kms:..."`, not empty — python-dotenv does not strip same-line trailing comments the way shell sourcing would. This turns an intentionally-empty, falsy default into a non-empty, **truthy** one, silently defeating every `if self.field:` check downstream (e.g. the deployed-environment SSE-KMS warning in `validate_startup()`). Rewrote all 13 affected lines to put every comment on its own line above the `KEY=value` it describes — the only fix that's correct regardless of the specific dotenv parser's inline-comment handling.

**Live-verified, not just tested**: generated a real `.env` via `scripts/gen_keys.py` (gitignored, never committed) and ran the actual service with `uvicorn app.main:app` — confirmed for real, over real signed HTTP requests: `/health` and `/ready` (the latter correctly shows `decision_bands: "three"` and the bootstrap-calibration warning), `POST /v1/security/pin/hash` → `POST /v1/security/pin/verify` (both correct-PIN match and wrong-PIN rejection with a decremented `attempts_left`), `POST /v1/storage/presign-put` (a correctly-shaped SigV4 URL), and `POST /v1/embed` against a synthetic non-face image correctly rejected with `NO_FACE_DETECTED` by the real YuNet detector. `/ready`'s AWS posture check correctly reports its own MinIO-connection failure (no Docker in this environment) rather than hanging or crashing.

**Not done in this phase, by design:** real MinIO connectivity (needs Docker, Phase 5), real calibration against team photographs (needs real employee photos, out of scope per `DECISIONS.md` B3/B4), unifying the two separate `docker-compose.yml` files into one root stack (Phase 5).

## Phase 3 — Person 1: Mobile Edge Client (parallel with Phase 4)

- [x] Point `src/lib/http.js`/`api.js` at the real local backend base URL — `VITE_API_BASE_URL`, new `.env.example`, defaults to `http://localhost:5000`
- [x] Verify raw-PIN flow end-to-end against the real backend (`DECISIONS.md` PIN decision) — confirmed no client change was needed; PIN was already sent raw, matching Person 3's real implementation
- [x] Verify refresh-token handling reads the response body correctly (`DECISIONS.md` B1) — path fixed from `/api/auth/refresh` to `/api/mobile/auth/refresh` (N3); body field was already correct
- [x] Get the check-in flow working against the real backend + AI service — rebuilt the whole payload to match Person 3's real `mobileCheckinSchema` (DECISIONS.md N2/N5): presigned upload replaces multipart (`uploadSelfie()`), added the required `device`/`captured_at` fields (`lib/deviceInfo.js`, using `@capacitor/device`'s real `isVirtual` flag for `is_emulator` — `is_rooted` has no implementation, honestly flagged rather than sent as a silent `false`-means-clean lie), dropped `employee_id` (identity now comes from the bearer token)
- [x] First real `npm install`/`npm test`/`npm run build` run — 57/57 vitest passing (29 in a rewritten `checkinFlow.test.js`), clean build. Fixed one real pre-existing bug (`backoffMs()`'s exponent clamp couldn't reach its own documented cap). `npm audit` surfaced 27 findings, all in `@capacitor/cli`/`capacitor-mock-location-checker`'s own build-tooling dependency chains (not the shipped bundle) — documented in the mobile README rather than force-fixed, since that risks breaking native sync tooling this phase can't verify without Xcode/Android Studio.
- [x] Wire the 15s heartbeat to call the new `POST /mobile/heartbeat` (`DECISIONS.md` B7) — path and payload shape both updated to match `mobileHeartbeatSchema` exactly (dropped the informal `employee_id`/`kind` fields the real endpoint doesn't expect)
- [x] `GET /api/mobile/me` wiring (`DECISIONS.md` N4) — `AppContext.jsx` rewritten to fetch the real profile instead of hardcoded demo state; the client-side `OFFICES` directory and Profile screen's office picker are gone (office assignment is the backend's now, matching a real deployment). Found and fixed a real crash along the way: `App.jsx`'s telemetry effect read `state.employee.id` unconditionally in its dependency array, which threw once `employee` legitimately started as `null`.
- [x] Login simplified to password-only (`DECISIONS.md` N3) — the PIN field on `LoginScreen.jsx` never was backed by any documented backend login check; removed rather than left implying a security gate that didn't exist server-side.
- [x] Manually verified in a real browser (mock-backend mode, since no live backend+AI service pair was running simultaneously in this environment): login → home → profile → check-in all render correctly against a real fetched profile shape, zero console errors.
- [ ] **Explicitly out of scope this phase:** native anti-mock-location checks, Android foreground service, iOS background location — all need a real native build (Android Studio/Xcode), which is outside "local dev-complete." Flagged for the deployment phase.
- [ ] **Deferred to Phase 5:** an actual live run against `Person3_BackendAPI` + `Person4_AIBiometricService` together (needs Docker for MongoDB/MinIO, unavailable in this environment) — everything above is code-complete and verified in isolation (real unit tests against the real contract, real UI render against mock data) but not yet proven end-to-end against the other two real services at once.

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
