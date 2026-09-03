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

### N10 — Express 5's `req.query` is getter-only; `validate.ts` was still assigning to it directly

The first real `docker compose up` against a genuine Express 5 server (ROADMAP.md Phase
5) turned the web dashboard's "Add employee" flow into a wall of 500s the instant it
loaded — `GET /api/attendance?status=flagged`, `GET /api/leave?status=pending`,
`GET /api/dashboard/trend`, `GET /api/attendance/feed` all failed identically. Backend
logs: `TypeError: Cannot set property query of #<IncomingMessage> which has only a
getter`, at `middleware/validate.js:24` — `(req[part] as unknown) = result.data;` when
`part === 'query'`. Express 4 allowed plain reassignment of `req.query`; Express 5
made it a getter-only accessor with no setter, a breaking change this backend's
`express: "^5.1.0"` pin already opted into without anyone having actually run a GET
route with query validation against it before.

**Decision:** for `part === 'query'` specifically, shadow the prototype getter with an
own data property via `Object.defineProperty(req, 'query', { value: result.data,
writable: true, enumerable: true, configurable: true })` instead of plain assignment —
Express's own documented workaround for middleware that needs to replace the parsed
query wholesale. `body`/`params` assignment is untouched (still works exactly as
before). Added `tests/unit/validate.test.ts`: a real `express()` app + `supertest`
(a hand-built mock `req` would not reproduce this — the getter-only behavior comes
from the real `http.IncomingMessage` prototype), covering the exact regression plus
that `422` (not `500`) still comes back for an invalid query and that `body`/`params`
assignment is unaffected. 4 new tests, all passing.

### N11 — Admin reference-photo presign hardcoded a 5MB `content_length`; Person 4's real ceiling is 200KB

`uploadService.ts#presignAdminUpload` requested a presigned PUT URL for `5 * 1024 *
1024` bytes with a comment explaining why: "the admin console presigns before it knows
the final byte count." That comment was wrong by the time it was written — 
`PhotoUpload.tsx` already compresses the file client-side to Person 2's own
`MAX_UPLOAD_MB = 0.2` budget *before* calling `requestUploadUrl`, so the real
compressed size is always known at presign time. Person 4's AI service independently
enforces `PNSM_MAX_UPLOAD_BYTES` (204800 by default — the same 200KB, not a
coincidence) at presign time and rejects anything over it with `PAYLOAD_TOO_LARGE`
(413) — so every single admin-console reference-photo upload failed outright,
regardless of the actual file's real, compressed, well-under-200KB size.

**Decision:** thread the real compressed byte count through instead of guessing.
`Person2_WebDashboard/src/api/uploads.ts#requestUploadUrl` now takes `contentLength`
(passed as `result.file.size` from `photo-upload.tsx`, the size *after* compression);
`Person3_BackendAPI`'s `adminPresignSchema` gained a required `contentLength` field;
`uploads.routes.ts` and `presignAdminUpload` forward it instead of the hardcoded 5MB.
This is exactly the pattern the mobile check-in presign flow already used correctly
(`Person1_MobileClient/src/lib/api.js` sends `blob.size` for real) — the admin path
was the one inconsistent with its own sibling. Backend 125/125, web dashboard 76/76
after the fix.

### N12 — Person 3 generates 4-digit PINs; Person 4's default policy requires 6+

Every PIN issuance during live employee creation failed with `PIN must be at least 6
digits.` (Person 4's `app/crypto/pin.py`, driven by `PNSM_PIN_MIN_LENGTH`, default 6,
range 4-12). Person 3's `generatePin()` has always produced exactly 4 digits, and
Person 1's `CheckInScreen.jsx` hardcodes `pin.length === 4` as its submit gate — B6's
original resolution ("PIN length = exactly 4 digits, matches what's already coded")
was correct about the *convention* the other two quadrants actually built to, but nothing
had ever configured Person 4's real service to match it until this run exposed the gap.

**Decision:** set `PNSM_PIN_MIN_LENGTH=4` explicitly in the root `docker-compose.yml`'s
`ai-service` environment — a one-line config change using a knob Person 4's service
already exposes for exactly this, not a code change to any quadrant. This is what
actually makes B6's resolution hold at runtime, not just in the docs.

### N13 — Embedding generation received a full URL where Person 4's AI service requires a bare object key

`tryGenerateEmbedding` called `ai.embed(userId, { kind: 's3_key', value:
referencePhotoUrl }, ...)` — passing the complete public URL
(`http://minio:9000/pnsm-selfies/refs/<id>/<ulid>.jpg`) as if it were the bucket key.
The code's own prior comment already flagged this as an unconfirmed gap ("this passes
the URL through as a base64/s3_key value is not guaranteed to resolve — recorded as a
known gap rather than guessed at"). It failed, always, with `object key is not within
a managed prefix` — confirmed directly from the AI service's own logs. Every employee
creation's embedding step failed silently (caught by `tryGenerateEmbedding`'s own
`catch`, see N14), for every employee ever created, until this run.

**Decision:** recover the real key deterministically instead of guessing at the
contract. `uploadService.ts#presignAdminUpload` already builds the public URL as
`${STORAGE_PUBLIC_BASE_URL}/${object_key}` — stripping that exact, known prefix off
`reference_photo_url` recovers the true key with no new coordination needed.
`objectKeyFromPublicUrl()` in `employeeService.ts` does this and is used by both
`tryGenerateEmbedding` call sites (`createEmployee` and `updateEmployeePhoto`).
Live-verified after the fix: a real employee's baseline enrolled successfully,
`embedding_model: arcface_w600k_mbf_v1`, stored in the isolated, AES-256-GCM-encrypted
`face_embeddings` collection exactly as designed.

### N14 — `createEmployee` reported success unconditionally, even when N12/N13 had just failed

Both `tryIssuePin` and `tryGenerateEmbedding` are deliberately best-effort (a biometric
or PIN service hiccup shouldn't block onboarding) — but `createEmployee`'s response
hardcoded `has_face_embedding: true` regardless of what `tryGenerateEmbedding` actually
did, and `tryIssuePin` returned the locally-generated plaintext PIN unconditionally,
even after its own `catch` block ran. Combined with N12 and N13 both failing on every
attempt before their fixes, this meant HR was shown "Profile created," a real PIN
number, and a green "Baseline enrolled"-shaped response for employees whose PIN hash
and face embedding were never actually written to the database — check-in would fail
for those employees later, for reasons invisible from the admin console.

**Decision:** both helper functions now return their real outcome —
`tryGenerateEmbedding` returns `boolean`, `tryIssuePin` returns `string | null` (`null`
on a caught failure) — and `createEmployee` reports exactly that instead of hardcoding
success. `Person2_WebDashboard/src/components/forms/employee-form.tsx` now shows an
explicit `"<name> was created, but needs attention"` error toast naming which step(s)
failed, instead of the same "Profile created" success toast used for a fully-working
onboarding. The employee list's existing "No embedding" badge (already reading
`has_face_embedding` correctly) now reflects reality instead of a hardcoded lie.

### N15 — Mobile route mount order: the entire `/api/mobile/*` family was unreachable on a real server

The single most severe finding of this pass. `routes/index.ts` mounted admin's router
at `/api` *before* mobile's at `/api/mobile`. Express tries `router.use()` mounts in
registration order, matching on path prefix — so every request to `/api/mobile/*`
matched admin's broader `/api` prefix first and was dispatched into `adminRoutes`.
That alone would have 404'd harmlessly and fallen through, except
`admin/superadmin.routes.ts` mounts `router.use(requireAuth('admin'))` at its own bare
`/` — required by Person 2's contract, which needs unprefixed routes like `GET
/admins` and `GET /audit` (see N7's sibling reasoning in that file's own comment) —
and a bare-`/` mount matches *any* unmatched path handed to that router, admin's own
404s included. The result: every request under `/api/mobile/*`, login included, was
intercepted by admin's auth gate and rejected with `401 {"error":{"code":
"UNAUTHENTICATED","message":"Sign in required."}}` before ever reaching
`mobileRoutes`. **The mobile API had never been reachable on any real running
instance of this backend.** Nothing in the test suite caught it: the only two
supertest-backed integration tests before this session (`auth.test.ts`,
`health.test.ts`) only ever requested `/api/auth/*`, and every mobile-client
verification to date ran with `VITE_MOCK_BACKEND=true`, which never makes this HTTP
request at all — this is exactly the class of bug that only a genuine live
cross-service run surfaces.

**Decision:** mount `/api/mobile` before the bare `/api` admin group in
`routes/index.ts`. `/api/mobile/*` never collides with any real admin route (none of
admin's own paths start with `/mobile`), so this is a pure reorder with no behavior
change for `/api/*` admin traffic — confirmed by a new regression test,
`tests/integration/mobileRouteMounting.test.ts`, which asserts (a) a mobile login
request reaches `mobileAuthService.mobileLogin` (proven by `User.findOne` being called
with an `employee_code` filter, not admin's `email` filter) and returns the mobile
bare-body shape, not admin's `{data,error}` envelope, and (b) admin routes under
`/api` still correctly 401 through `requireAuth` exactly as before. Live-verified after
the fix: mobile login, `GET /api/mobile/me`, and the full check-in pipeline all worked
against the real running stack for the first time.

### N16 — The mobile client's HTTP interceptor treated *any* 401 as "session expired," including a wrong PIN

Discovered live, immediately after N15's fix made mobile login work at all: entering
one incorrect check-in PIN didn't show a "wrong PIN, N attempts left" message — it
silently logged the employee all the way out to the login screen. Root cause in
`Person1_MobileClient/src/lib/http.js`'s response interceptor: it treated every `401`
status as "the access token is stale," unconditionally attempting a refresh-and-retry.
But a `401` is also the HTTP status for *any* mobile business-rule rejection under the
shared response convention (`mobileError`, ADR-1) — `pin_mismatch`,
`outside_geofence`, `mock_location_detected`, `liveness_failed`, `low_face_match` all
return 401, distinguished only by a `reason` field in the body, not by status code.
So: wrong PIN → interceptor calls `/api/mobile/auth/refresh` (succeeds, the session
was fine) → replays the *original* check-in request with the same wrong PIN →
predictably 401s again, re-verifying (and re-consuming an attempt against) the PIN a
**second** time → that second rejection, now flagged `_pnsmRetried`, falls through to
the interceptor's outer `catch`, which was written to mean "the refresh itself
failed" — and unconditionally calls `clearAccessToken()` + `onSessionExpired()`,
logging the employee out of a session that was never actually invalid.

**Decision:** only the mobile API's own `reason: 'unauthenticated'` (the exact shape
`requireAuth`'s `sendUnauthenticated` sends for mobile, see `middleware/auth.ts`)
means "your session actually expired." Every other 401 `reason` is a business
rejection the caller should see and let the user retry on the same screen, not a
reason to touch the token at all. Added `__tests__/http.test.js`: asserts a
`pin_mismatch` 401 rejects immediately with no refresh attempt and no session-expired
callback (session survives), the same for the other business-rule reasons
(`outside_geofence`, `mock_location_detected`, `liveness_failed`, `low_face_match`),
and that a genuine `unauthenticated` 401 still triggers the refresh path as before. 3
new tests, all passing; full suite 60/60 after the fix.

### N17 — Attendance Logs page's own "All statuses" default broke the page outright

`AttendanceView`'s status filter defaults to, and has an explicit `<option
value="all">All statuses</option>` for, the literal string `'all'` — which was sent
straight through to `GET /api/attendance?status=all`. The backend's
`listAttendanceQuerySchema` has no `'all'` member; `status` is `z.enum(ATTENDANCE_
STATUSES).optional()` — meaning "omit the field entirely" is how "no filter" is meant
to be expressed. Every request from this page's own default, un-touched filter state
therefore failed schema validation with `422 VALIDATION_FAILED`, permanently, until a
user manually picked a specific status. `officeId` handles the exact same shape of
problem correctly one line above (`officeId: officeId || undefined`) — `status` was
simply the one place that pattern wasn't applied.

**Decision:** `status: status === 'all' ? undefined : status` in the query builder,
mirroring `officeId`'s existing, working pattern immediately above it. Live-verified:
the Attendance Logs page now loads correctly on its own default state and shows real
check-in rows (GPS, face-match score, status) pulled from the live backend.

---

**Summary of the Phase 5 live-testing pass (N10-N17):** all eight were found only by
actually running `docker compose up` and exercising the real system through a real
browser — none were catchable by any unit or mocked-integration test that existed
before this session, because none of the four quadrants had ever had a real
cross-service HTTP call made against them before. N15 in particular means the mobile
app had *never* successfully talked to a real instance of this backend at any prior
point in the project's history. This is the concrete argument for why ROADMAP.md
Phase 5 existed as its own phase rather than being assumed to follow automatically
from Phases 1-4 all passing their own isolated test suites.

### N18 — Bootstrapping the first Super Admin: a seed script, not a signup route

N10-N17's live pass exposed one more gap along the way, distinct from the eight bugs
above: nothing in this system can create its *first* account. Admin accounts are
created by an existing admin (a permission-gated `POST /api/employees`-shaped flow
has no equivalent for admins at all — `superadmin.routes.ts` has no create-admin
route either, only `GET /admins`), and mobile employee accounts are created by an
admin console user (N3). A genuinely empty database — exactly what a fresh
`docker compose up` produces — has no account anywhere that could log in and create
the first one. The live pass worked around this by inserting a Super Admin directly
via a one-off `node -e` snippet against the raw `mongoose` connection; that got the
verification pass moving but left nothing reusable in the repository.

Two ways to close this were considered:

- **A guarded first-run signup endpoint** (e.g. `POST /api/auth/bootstrap`, allowed
  only while `User.countDocuments() === 0`). Rejected: it's permanent API attack
  surface for a system that stores biometric data, active for the entire life of any
  deployment that is slow to run its first admin creation — a race between an
  attacker's request and the real operator's first login is a real, if narrow,
  window; "empty database" is also a weaker gate than it looks, since a deployment
  can legitimately pass through an empty-but-not-yet-initialized state more than
  once (e.g. after a restore).
- **A seed script**, run directly against the database rather than through the API,
  matching the pattern this project already uses for exactly this kind of one-time
  local-dev bootstrapping (Person 4's `scripts/gen_keys.py`). No new runtime API
  surface, nothing to guard, works identically for local dev and for a real
  deployment's first-run playbook (any deploy tooling can just run it as a one-shot
  job before traffic is accepted).

**Decision:** a seed script, `Person3_BackendAPI/src/scripts/seed.ts`. Idempotent —
upserts the three `Role` documents (`$setOnInsert`, never overwriting an existing
role's `permissions`) and creates a Super Admin only if none exists at
`PNSM_SEED_ADMIN_EMAIL` (default `admin@pnsm.local`); running it again against an
already-seeded database is a safe no-op, reported as such rather than erroring.
Without `PNSM_SEED_ADMIN_PASSWORD` it generates a random one and prints it exactly
once — the same "generate and show once" idiom `employeeService.ts` already uses for
PINs and initial passwords (N14), rather than a hardcoded default password shipped in
source control. Runnable two ways: `npm run seed` (host, via the `ts-node` devDependency
already in `package.json`) or `node dist/scripts/seed.js` inside a running container
— the latter needs no new dependency in the runtime image at all, since `src/scripts/
seed.ts` is picked up by the existing `tsc` build the Dockerfile's build stage already
runs, and only imports packages (`mongoose`, `bcryptjs` via `utils/password`) already
in the production `dependencies`, not `devDependencies`.

`main()` is guarded behind `require.main === module` specifically so
`ensureRoles`/`ensureSuperAdmin` can be imported and unit-tested (`tests/unit/
seed.test.ts`, 5 tests: upserts all three roles without clobbering an existing one's
permissions; creates a new Super Admin with a generated password and confirms the
plaintext is never what gets persisted as `password_hash`; is a no-op when the account
already exists; honors `PNSM_SEED_ADMIN_EMAIL`/`PNSM_SEED_ADMIN_PASSWORD` and
normalises the email; and refuses to create a user with no `role_id` if the Super
Admin role is somehow missing, rather than writing an unrooted account) without those
tests connecting to a real database or triggering `process.exit`.

Live-verified twice: against the real running compose stack's database (correctly
reported the existing Super Admin and changed nothing — the idempotent path), and
against a genuinely fresh, throwaway MongoDB container (created the account and
printed a real generated password on the first run, then correctly reported it as
already existing and changed nothing on an immediate second run — the create and
idempotent paths both exercised against a real, empty-then-seeded database, not just
the mocked unit tests). Confirmed separately that the real compose stack's own
pre-existing admin login was unaffected throughout. Backend 132/132 after this
addition (127 + 5 new), clean typecheck, clean build.
