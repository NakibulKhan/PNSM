# Decisions

This project was originally built as four independent quadrants against a shared spec
(`PNSM_4Person_Bulletproof_Plan.pdf`), each written without the others able to negotiate
in real time. That produced a set of genuine, documented disagreements between quadrants —
this doc records how each one was resolved so the codebase can move forward consistently.
Each entry keeps the original conflict ID from the source reports so it's traceable back to
where it was first raised.

Format: **what the conflict was → what was decided → why → what it touches.**

## B1 — Refresh token delivery

**Conflict:** The blueprint wants the refresh token *only* in an `HttpOnly` cookie. Person 3
implemented "issue both" (cookie **and** response body) because Person 2's `api-client.ts`
reads `refreshToken` from the body, and Capacitor WebViews are unreliable with cookies
across the native bridge. Person 2's own `03-MERGE-GUIDE.md` separately listed "refresh
token must be in an HttpOnly cookie, never in the JSON body" as a thing that would break
integration — the two documents read as opposite positions.

**Decision: keep "issue both."** The cookie gives real XSS hardening for browser contexts
that can use it; the body covers Capacitor and any server-to-server caller that structurally
can't rely on a cookie jar. This is not a compromise of security posture — it's additive,
not a replacement of the cookie with the body.

**Touches:** Person 3 (already implemented, no change needed), Person 2 (its
`api-client.ts`/token-store keeps reading the body field as-is — no change needed either),
Person 1 (verify the mobile client's HTTP layer reads the body token, not just relying on
the cookie, since Capacitor is exactly the case this exists for).

## B2 — Face-match "rejected" vs "flagged," and the runtime-default clash

**Conflict:** The blueprint's own Quadrant IV text is self-contradictory ("flagged... status
is set to rejected"). Proposal FR-07, Person 2's entire review-queue UI, and ADR-5 all
expect a below-threshold match to be `flagged` for HR review. Person 3's backend hardcodes
`flagged`. But Person 4's AI service has a runtime toggle, `PNSM_DECISION_BANDS`, that
**defaults to the two-band master-plan model**, under which `flagged` is never actually
returned — so as shipped, the two already-written codebases silently disagree, not just the
docs.

**Decision: keep `flagged`, and set `PNSM_DECISION_BANDS=three` as the standing
configuration for Person 4's service.** Auto-rejecting a low-confidence match removes the
human review step that HR depends on and that FR-07 requires; `rejected` stays reserved for
hard business-rule failures (PIN, geofence, mock location, liveness), not an ambiguous face
match.

**Touches:** Person 4 (set `PNSM_DECISION_BANDS=three` in its default env/config, not just
document it as an option), Person 3 (no code change, its `flagged` default was already
correct), Person 2 (its review-queue UI's assumption was correct all along).

## B3 — MongoDB Atlas tier / B4 — AWS vs Render+R2

**Conflict:** Blueprint mandates Atlas M10+ (~$57/month) and full AWS ECS/CloudFront.
The graded proposal budgets Atlas M0 free tier and Render/Koyeb + Cloudflare R2.

**Decision: moot for now.** Local dev-complete scope runs a local MongoDB and a local
S3-compatible store (MinIO — Person 4's storage code already supports this for local dev)
via docker-compose. No cloud account, real or free-tier, is provisioned as part of this
phase. When an actual deployment phase happens, this decision needs revisiting with real
budget/ownership input — recorded here as open, not resolved.

**Touches:** Person 4 (docker-compose local stack), Person 3 (connection strings point at
local Mongo/MinIO via env vars, not hardcoded).

## B5 — Node `slim` vs Alpine base image

**Decision: no change — Alpine stays.** Already correctly justified: the backend
deliberately uses `bcryptjs` (pure JS, zero native deps) specifically so Alpine's musl libc
is a non-issue, and it produces a smaller image.

## B6 — Rollup of older open items

- **Work week (Sun–Thu vs Mon–Fri):** decided **Sun–Thu**, matching the project's
  Bangladesh/NSU context (also consistent with Person 2's Bangla-locale handling
  elsewhere in the risk register).
- **PIN length:** decided **exactly 4 digits** — matches what Person 3's backend already
  enforces; the proposal's "4–6 digits" language is superseded by this.
- **Mobile auth contract (ADR-6):** resolved by the PIN transmission decision below.
- **Collection count (8 in the proposal vs 14 delivered):** accepted as-is — 14 is the real,
  correct schema (13 domain models + the decoupled `FaceEmbedding` collection from B-A8).
  This is a documentation-currency issue for the original proposal writeup, not a code
  change.

## B7 — Background heartbeat endpoint

**Conflict:** Person 1's mobile client fires a heartbeat every 15 seconds to prove the
device is alive even when stationary. No backend endpoint for it existed.

**Decision: build it.** A lightweight `POST /mobile/heartbeat`, rate-limited per device,
backed by a capped/TTL collection (not unbounded inserts, given the volume). Scheduled as
part of Backend's Phase-2 work — see `ROADMAP.md`.

## PIN transmission — raw vs hashed (Person 1's Open Issue #1, labeled BLOCKER)

**Conflict:** The blueprint contradicts itself — Quadrant I's spec says send a *hashed* PIN;
Quadrant III's spec says the backend does `bcrypt.compare()` against a stored hash, which
needs the plaintext (bcrypt's salt is embedded per-hash, so you cannot compare two
independently-hashed values). The API contract says send the raw PIN.

**Decision: raw PIN over TLS, hashed server-side with bcrypt** (+ Person 4's
`pin_hash`/`pin_algo: "bcrypt-hmac-sha256-pepper"`/`pin_pepper_version` pepper scheme,
which already assumes this and is the only option actually compatible with a
bcrypt-compare backend). Hashing the PIN client-side before sending it would be security
theater against this design — an attacker who captured the "hashed" value could replay it
exactly as if it were the real credential, since bcrypt-compare needs the plaintext, not a
client-computed digest. TLS in transit is the actual protection here, matching how normal
password auth works everywhere else.

**Touches:** Person 1 (already implemented raw-PIN as its default, per its own README —
this decision confirms that was the right call, no rework needed), Person 3 (bcrypt-compare
against the pepper-augmented hash, per Person 4's schema), Person 4 (owns the pepper
scheme and hash generation).

## Broken doc references

Person 3's `README.md` references `PNSM_Backend_Architecture_Report.md` and
`PNSM_Backend_ADR.md` as design-decision sources. Neither file exists anywhere in this
project. **Decision:** repoint those references at this file (`DECISIONS.md`) and
`ROADMAP.md`, which now serve that purpose.

## New conflicts found while implementing Backend Phase 2

The entries above were the conflicts each quadrant's own docs already flagged. Building
the actual check-in pipeline (ROADMAP.md Phase 1) surfaced several more — real contract
mismatches between already-written code in different quadrants that no single doc stated
as a conflict, because each side wrote against its own understanding of the other's
interface. Resolved the same way: read the most authoritative source for each side,
pick the resolution, implement it consistently, record it here.

### N1 — PIN and face verification are Person 4's, not local to the backend

Person 3's Phase-1 scaffold built a local `hashPin`/`comparePin` (plain bcrypt, no
pepper) in `utils/password.ts`, plus a `FaceVerificationService` interface mocked by
`MockFaceVerificationService` — both explicitly placeholders (ADR-8) pending Person 4's
real service. Person 4's actual, shipped `pnsm-ai-svc` (read directly from
`Person4_AIBiometricService/docs/API.md`, `docs/INTEGRATION.md`, and
`clients/node/pnsmAiClient.js`) is a separate HMAC-signed HTTP service that owns **both**
PIN hashing/verification (`POST /v1/security/pin/hash`, `POST /v1/security/pin/verify` —
with its own pepper secret Person 3 never sees, plus lockout: 5 attempts then a 15-minute
lock enforced by Person 4, not Person 3) **and** face embedding/verification
(`POST /v1/embed`, `POST /v1/verify`), per its ownership map.

**Decision:** the backend copies Person 4's reference client
(`clients/node/pnsmAiClient.js`, ported to TypeScript as
`src/services/aiClient/pnsmAiClient.ts`, kept behaviorally identical — do not hand-roll
the HMAC signing per Person 4's explicit instruction) and calls it for every PIN and face
operation. `utils/password.ts`'s `hashPin`/`comparePin`/`generatePin` and the
`FaceVerificationService` mock are superseded for the real pipeline — left in place,
unused, rather than deleted, since they're tested code that documents the placeholder
they replace. `comparePassword`/`hashPassword` (admin login password, not the PIN) are
unaffected — those stay local, Person 4's service has no concept of the admin password.

### N2 — Selfie/reference-photo uploads go through Person 4's presigned URLs, not through Person 3's server

Person 3's Phase-1 scaffold built `storageService.ts` to receive the selfie as a
multipart buffer and `PutObjectCommand` it server-side. Person 1's already-written
`checkinService.js`/`api.js` matches that assumption (`buildCheckinFormData` posts a
`selfieBlob` as multipart). Person 4's actual `INTEGRATION.md` §3.1 and `API.md`
(`POST /v1/storage/presign-put`/`presign-get`) are explicit that this is wrong: "Do not
send image bytes through Person 3's API... it removes image traffic from both
containers, which matters when the whole task has 1 GB." Storage (bucket, CORS,
presigning) is entirely Person 4's per the ownership map.

**Decision:** adopt Person 4's presigned-upload flow. Person 3's role is a thin,
authenticated proxy: a route calls the AI client's `presignPut`/`presignGet` and returns
the result; the actual image bytes never touch Person 3's process. `storageService.ts`
(direct server-side upload) is superseded and left unused — real S3/R2 credentials
were never going to be available for local dev-complete anyway (`DECISIONS.md` B3/B4).
**Touches Person 1 (Phase 3):** `checkinService.js` must change from multipart upload to
(1) request a presigned URL, (2) `PUT` the compressed blob directly to the bucket,
(3) send only `object_key` in the check-in JSON body, matching Person 4's §3.1 sequence
exactly.

### N3 — Mobile auth gets its own route family (closes ADR-6)

Person 1's `http.js` already calls `/api/auth/refresh` expecting a **bare**
`{ access_token }` body (snake_case), and `LoginScreen.jsx`'s comment describes
`POST /api/auth/login` with `{ id, password, pin }`. Both paths collide with the admin
auth routes already built at the same paths, which use `{email,password}` and the
`{data,error,meta}` envelope (`ADR-1`) — the two conventions cannot share one path.

**Decision:** mobile auth is mounted separately, under `/api/mobile/auth/*`
(`login`, `refresh`, `logout`), using the existing `mobile` route-group convention
(bare body, already built in `middleware/routeGroup.ts`/`requireAuth('mobile')`) rather
than reusing `/api/auth/*`. Login accepts `{ employee_code, password }` — **password
only**, matching every other documented login flow; the "2FA PIN" field on
`LoginScreen.jsx` is not backed by any documented backend login check anywhere (Person
4's PIN verification is documented only as step 2 of the *check-in* sequence, never
login). Reuses `authService.login`'s underlying logic (same JWT issuance, same
`User`/`Role` lookup), just keyed on `employee_code` instead of `email` and formatted as
a bare mobile response. Refresh accepts the token from the cookie **or** a
`{ refresh_token }` body field (same "issue both" reasoning as B1 — Capacitor cookies are
unreliable), returns `{ access_token }` bare, and rotates the cookie.
**Touches Person 1 (Phase 3):** `http.js`'s hardcoded `/api/auth/refresh` becomes
`/api/mobile/auth/refresh`; `LoginScreen.jsx` drops the client-side PIN gate (the PIN
still appears once per check-in, verified server-side, exactly as `checkinService.js`
already does) and posts to `/api/mobile/auth/login`.

### N4 — A new `GET /api/mobile/me` endpoint, since none of Person 1's screens fetch real data yet

`AppContext.jsx`, `HomeScreen.jsx`, and `ProfileScreen.jsx` are all hardcoded demo state
today (`OFFICES.hq`/`.north`/`.south` string-keyed offices, a static employee, static
history) — there is no existing mobile "home" or "profile" fetch to match. Check-in also
needs a real Mongo `geofence_id`, which a hardcoded `office.key` slug can never provide.

**Decision:** add one endpoint, `GET /api/mobile/me`, returning the employee's own
profile, assigned office, assigned geofence (as `{ lat, lng }`, not raw GeoJSON — mobile
should never construct a GeoJSON pair by hand, same reasoning as `utils/geo.ts`), shift,
and recent attendance history — enough to drive both `HomeScreen` and `ProfileScreen`
plus supply a real `geofence_id` for check-in. **Touches Person 1 (Phase 3):** replace
`AppContext`'s hardcoded `initialState`/`OFFICES` with a fetch from this endpoint.

### N5 — Check-in device fields Person 1 hasn't sent yet

Person 4's `/v1/verify` requires a `device` object (`platform`, `os_version`,
`app_version`, `is_mock_location`, `is_emulator`, `is_rooted`) and a `captured_at`
timestamp with ±120s skew tolerance — none of `checkinService.js`'s current payload
fields map onto `is_emulator`/`is_rooted`/`os_version`/`app_version`/`platform`, only
`mock_location_flag` (→ `is_mock_location`) and `timestamp` (→ `captured_at`) do.

**Decision:** the backend's mobile check-in schema requires the full device object;
missing fields fail validation rather than silently defaulting (a missing emulator/root
flag is exactly the kind of gap that should be loud, not silently treated as "false").
**Touches Person 1 (Phase 3):** extend the check-in payload with the missing fields —
platform/os_version/app_version are cheap (`Capacitor.getPlatform()`, `Device` plugin);
`is_emulator`/`is_rooted` need real detection logic that does not exist yet in this
codebase and is flagged again here so it isn't lost.

### N6 — `days_of_week` label parsing needed at the admin write boundary

Person 2's employee-creation payload sends `days_of_week` as a display label
(`"Sun-Thu"`), but Person 3's `Shift` model treats the numeric array as the only source
of truth and *derives* the label (`ADR-3`, `deriveWeekLabel` in `utils/shiftDays.ts`) —
deliberately never the other direction, to keep the model's invariant that the label is
always regenerated, never hand-authored.

**Decision:** add a label→days parser (`utils/shiftDays.ts`'s new `parseWeekLabel`)
used **only** at the admin employee-creation/update route boundary — not inside the
`Shift` model, which keeps deriving the label from the array exactly as before. Round-trips
`"Sun-Thu"`/`"Mon-Fri"`/`"Every day"`/comma-separated lists correctly since
`deriveWeekLabel` already defines the canonical output shape this must invert.

### N8 — `FaceEmbedding` schema corrected to match Person 4's real envelope shape

Person 3's Phase-1 `FaceEmbedding` model stored a ciphertext string (`vector_data`) plus
an `{algorithm, key_id}` pair, matching the local `embeddingCrypto.ts` seam built for
ADR-8's placeholder. Person 4's actual `POST /v1/embed` response returns a structured
`envelope` object (`{v, kp, kv, dek, alg, iv, ct, tag, model_version, created_at}`) with
an explicit instruction: "store `envelope` verbatim... do not reformat it... do not
validate the shape yourself, because it will change again."

**Decision:** `FaceEmbedding.envelope` is now `Schema.Types.Mixed` (opaque, `select:
false`), replacing `vector_data`/`encryption`. `model_version` stays as a top-level
field (mirrors `envelope.model_version`, cheap to query without touching the opaque
blob). `services/faceVerification/embeddingCrypto.ts`'s `EmbeddingCipher` seam is
superseded along with the rest of N1 — Person 3 never encrypts or decrypts a vector at
all now, Person 4 does both ends. Left in place, unused.

### N7 — Object storage for local dev: MinIO, not R2/S3

Backend Phase 1's `docker-compose.yml` (already present) only defines `mongo`; there is
no local object store, and `STORAGE_PROVIDER` defaults to `r2` with empty credentials.
Since uploads are now proxied through Person 4's AI service (N2), Person 3's own
`docker-compose.yml` needs a MinIO service so `PNSM_AI_URL` has something to presign
against locally — this is Person 4's Phase 2 concern to configure fully, but Person 3's
compose file gets a MinIO service added now so `docker compose up` here is not
half-wired ahead of Phase 2.

### N9 — Removed the dead pre-N1/N2 face-verification and storage modules; `Policy.face_match_threshold` is display-only

Phase 5 (root-level `docker-compose.yml`) needed an accurate list of which env vars
each service actually reads. Cross-checking `Person3_BackendAPI/src/config/env.ts`
against real call sites turned up two modules N1/N2 had already fully superseded but
that were never deleted: `services/faceVerification/` (ADR-8's `mock`-only adapter
interface, plus the `embeddingCrypto.ts` seam N8 noted as "left in place, unused") and
`services/storage/storageService.ts` (ADR-7's direct R2/S3 client). Neither was
imported by any route — `attendanceService.ts` and `uploadService.ts` both call Person
4's AI client directly, per N1/N2. Their only callers were their own now-deleted test
files (`faceVerification.test.ts`, `storageService.test.ts`), which is why the count
before this cleanup was 133 and not the still-meaningful 121.

**Decision:** deleted both modules, their tests, the `@aws-sdk/client-s3` dependency
(no longer used by anything), and the matching dead `STORAGE_*`/`FACE_SERVICE_PROVIDER`
env vars — kept only `STORAGE_PUBLIC_BASE_URL`, which `uploadService.ts` genuinely
still reads to build a display URL for admin reference-photo uploads.

While tracing this, also found that `Policy.face_match_threshold` (seeded at 85,
editable through the super-admin policy endpoint) is never read by
`attendanceService.ts` — the check-in decision comes entirely from
`result.decision` on Person 4's `/v1/verify` response, which is computed against
Person 4's own `PNSM_APPROVE_THRESHOLD`/`PNSM_FLAG_THRESHOLD`. Editing the policy
value through Person 2's dashboard has no effect on check-in behavior today. This is
a real cross-quadrant gap, not fixed here (closing it means either the backend
pushing policy changes to Person 4's `/v1/admin/recalibrate`, or Person 4 reading the
threshold from Mongo instead of its own `.env` — an architecture decision, not a
local cleanup) — documented so it is not mistaken for working configuration. The
also-dead `env.ts` export of `DEFAULT_FACE_MATCH_THRESHOLD` (env-var driven, default
85) was removed too: nothing imported it — `models/Policy.ts` imports an
identically-named but separate hardcoded constant from `constants/index.ts` instead,
so the env var never did anything even before this cleanup.

Backend re-verified after this change: 121/121 tests, clean typecheck, clean build.
