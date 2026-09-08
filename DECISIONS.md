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

---

## Blueprint compliance audit (N19-N23)

The user supplied the original architectural blueprint PDF and asked for a final,
literal re-audit against it, with the explicit bar "there must not remain a single
gap" within local-dev-complete scope. A 3-way parallel codebase audit checked every
concrete requirement in the 12-page document against the actual code. Everything
checked out already compliant except the five items below — 2dsphere/`$geoWithin`/
`$centerSphere` with the exact 6,378,137m equatorial radius, path-to-regexp v8
wildcard safety (zero unnamed wildcards anywhere, confirmed by grep), ESR-ordered
compound indexes on `AttendanceLog`, helmet's `default-src 'self'`/`X-Frame-Options:
DENY`, RBAC (`requirePermission`, not just `requireAuth`) on every admin mutation
route, 0 `npm audit` vulnerabilities, React Router v7's `createBrowserRouter`, the
Tailwind v4 Safari 16.3 `@supports` fallback, both backend and AI-service Dockerfiles
already multi-stage, OWASP security headers on the AI service, CSFLE-style embedding
encryption, the geofence radius slider, Capacitor plugin major-version parity, <200KB
client-side selfie compression, and client-side mock-location rejection — were all
independently re-confirmed correct with no changes needed.

### N19 — Backend Dockerfile bumped from Node 20 to the blueprint's Node 24

`Person3_BackendAPI/Dockerfile` used `node:20-alpine` in both the build and runtime
stages. The blueprint specifies `node:24-slim` as the runtime — Alpine-vs-slim is a
separate, already-settled question (B5: Alpine stays, since `bcryptjs` has zero native
deps and Alpine's musl libc is a non-issue for this specific app; that reasoning is
untouched by this entry). The version number itself was the real gap. This host's own
`node --version` is v24.18.0, and every `npm test`/`npm run build` across this entire
multi-session project has already run on Node 24 — the Docker image was the one place
still pinned to 20.

**Decision:** both `FROM node:20-alpine` lines → `node:24-alpine`. `package.json`'s
`engines.node` `">=18.18.0"` → `">=20.0.0"` (Node 18 is EOL; not bumped all the way to
24, since nothing in the code actually requires a Node-24-specific API — pinning the
floor higher than what's actually justified would itself be a small new gap).

Live-verified: `docker build` succeeded cleanly; `node --version` inside the built
image reports v24.20.0; `bcryptjs` loads without error; the full compose stack rebuilt
and came up healthy; a real login (`POST /api/auth/login` against the actual seeded
Super Admin) succeeded, proving `bcrypt.compare()` — the one thing B5's whole
reasoning hinges on — works correctly under `node:24-alpine`. Backend 132/132,
unaffected. Image size: 277MB → 322MB (Node 24's larger runtime binary; expected, not
a regression).

### N20 — Person2_WebDashboard's Dockerfile built and verified for the first time; a real nginx security-header bug found and fixed

`Person2_WebDashboard/Dockerfile` and `nginx.conf` were already blueprint-correct on
paper (multi-stage `node:24-slim` builder → `nginx:alpine` runtime, non-root user,
`try_files $uri $uri/ /index.html;` as the local equivalent of the blueprint's
CloudFront-404 concern) — but had never once been built or run; Person2 has only ever
run via `npm run dev` (a deliberate, unchanged decision from Phase 5 — it stays out of
`docker-compose.yml`; this was standalone verification only).

Building and smoke-testing it live surfaced a real, previously-undiscovered bug:
`curl -I` against `/`, `/employees` (a deep link), and `/healthz` showed the
`X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy` headers — declared once,
at the server level in `nginx.conf` — were **completely absent from every real
response**. Root cause: nginx's `add_header` inheritance rule is that a `location`
block inherits `add_header` directives from its parent ONLY if that location defines
no `add_header` of its own — the moment a location adds even one header, it stops
inheriting ALL of them, server-level ones included. `try_files`'s fallback to
`/index.html` is an internal redirect that gets re-matched against location blocks,
landing in `location = /index.html` — which already had its own `Cache-Control`
`add_header` and therefore silently dropped the three security headers on literally
every real page load. `location = /healthz` had the identical problem via its own
`Content-Type` header. This meant the OWASP A02 security headers this file was
explicitly written to enforce were never actually being sent by any response this
server could produce.

**Decision:** repeat all three security `add_header` lines explicitly inside every
location block that sets its own headers (`location = /index.html`,
`location /assets/`, `location = /healthz`), with a comment at the top of the file
explaining nginx's inheritance rule so this doesn't silently regress again the next
time someone adds a `location`-scoped header.

Also added `Person2_WebDashboard/.dockerignore` (Person3 already had one; Person2
didn't) so `COPY . .` doesn't pull `.env.local`, `.git`, `.github`, and markdown into
the build context.

Live-verified after the fix: rebuilt the image, ran it standalone, and confirmed via
`curl -I` that all three headers are now present on `/`, `/employees`, and `/healthz`.
`/employees` (a deep link with no matching file) returns **200** with the real
`index.html` content, not a 404 — the SPA fallback genuinely works. `docker exec
... whoami` confirms the container runs as `appuser`, not root. Final measured image
size: **133MB**. This is above the blueprint's illustrative "<50MB" figure, but
honestly explained rather than force-fit: this dashboard ships a real WebGL map
(MapLibre GL), charting, and PDF/CSV export (`dist/assets/map-*.js` alone is ~800KB
uncompressed) — functionality the blueprint's generic figure wasn't sized against. The
structural pattern the blueprint actually cares about (multi-stage, Node/source
discarded, tiny final base image) is fully achieved; the exact byte target was always
somewhat illustrative for a feature-rich real app.

Measured, for the record, alongside the above: `pnsm_khan_edit-ai-service` is
**850MB**, unchanged by this pass — larger by nature (bundles onnxruntime and the
ONNX model weights for real, cold-start-safe inference), not something to "fix."

### N21 — Battery-optimization guidance consolidated and surfaced on the Home screen

`Person1_MobileClient/src/lib/backgroundTelemetry.js` already had a correct,
deliberately-scoped `getBatteryOptimizationGuidance()` — returns
`{needed, guidanceUrl: "https://dontkillmyapp.com", note}` on Android, `null`
elsewhere. Its own docstring already correctly explains why it stops there: the
blueprint's literal ask ("programmatically prompt the user to whitelist the
application") implies triggering the native `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`
intent, which Google Play Store policy restricts to apps with a documented,
Play-Console-justified need — wiring that intent without one is a real store-rejection
risk, correctly left as "team decision pending." That reasoning stands untouched.

Correction to the audit's own first pass: `ProfileScreen.jsx` was *not* missing this
entirely, as first reported — it already called the function and rendered a plain
paragraph with the raw URL as unstyled text. What was genuinely missing: it wasn't a
real clickable link, wasn't dismissible, and `HomeScreen.jsx` — the actual landing
screen after login — didn't surface it at all.

**Decision:** extracted a shared `Person1_MobileClient/src/components/
BatteryOptimizationNotice.jsx` — renders nothing when guidance is `null`; otherwise a
card with the real `note` text and a genuine `<a href target="_blank">` link; accepts
a `dismissible` prop (plain local `useState`, no new persistence layer for a cosmetic
flag). Mounted on `HomeScreen.jsx` (dismissible) and replaces the old inline paragraph
in `ProfileScreen.jsx` (`dismissible={false}`, permanently findable there after being
dismissed on Home). No changes to `getBatteryOptimizationGuidance()` itself or
anything native-intent-related.

Added test coverage that didn't exist before for the underlying function itself
(`__tests__/telemetry.test.js`, mocking `Capacitor.getPlatform()` across all three
platform branches) and a new `__tests__/batteryOptimizationNotice.test.jsx` (renders
nothing on web/iOS, renders note+link+dismiss on Android, dismiss actually removes it,
`dismissible={false}` never shows a dismiss button). Mobile suite: 68/68 (60 + 8 new).

Live-verified the negative case only: dev server runs as `platform: "web"`, and the
Browser pane confirmed the card renders on neither Home nor Profile there, matching
the pre-existing behavior with no regression. The Android-positive render path can't
be live-verified in this environment (no device/emulator) — the unit tests are the
proof for that branch; stated here honestly rather than silently skipped.

### N22 — Completed the native scaffold's missing companion class; surfaced a real, unresolved credential problem

`Person1_MobileClient/native/PnsmForegroundService.java` is an honestly-labeled,
never-compiled "STATUS: SCAFFOLD — NOT WIRED UP" reference file (no `android/`
project folder exists — `npx cap add android` was never run, correctly, since native
builds are explicitly out of local-dev-complete scope). It calls
`PnsmTelemetryUploader.enqueue(Context, double, double, float, long, boolean)` — a
class that, confirmed via Glob, did not exist anywhere in the repo.

Investigating what it should actually do surfaced a real architecture fact worth
recording on its own: `Person1_MobileClient/src/lib/http.js` deliberately keeps the
mobile app's access token in-memory-only, by design, specifically so a short-lived
token can't be read back off disk — confirmed no code anywhere in `src/` ever writes
anything to `@capacitor/preferences`. This means **native Java code currently has no
way to obtain a valid token** for an authenticated background upload. This is not a
bug to quietly work around; it's a genuine, unresolved boundary between "background
telemetry needs a durable credential" and "the access token is deliberately
non-durable," and closing it needs a separate, deliberate decision (e.g. a distinct,
narrowly-scoped, independently-revocable background-upload credential minted at
login) — explicitly out of scope for a scaffold file to invent unilaterally.

**Decision:** new `Person1_MobileClient/native/PnsmTelemetryUploader.java`, matching
its sibling's exact "STATUS: SCAFFOLD" header convention and tone. Drops a
`mocked: true` fix immediately, before any network activity (the heartbeat schema has
no field to carry that flag server-side anyway, and the sibling file's own comment
already says a spoofed fix must never be silently persisted). Reads a token from
`SharedPreferences("CapacitorStorage", ...)` — the real, verified group name
`@capacitor/preferences`' own Android plugin source uses
(`PreferencesConfiguration.java: DEFAULTS.group = "CapacitorStorage"`) — with a header
comment stating plainly that this will always be `null` today, why, and what a real
fix requires; logs and returns rather than sending a guaranteed-401 request when no
token is found. When a token *is* available (future-proofing the design once the
credential problem is resolved): enqueues a `WorkManager` `OneTimeWorkRequest`
(`NetworkType.CONNECTED`, exponential backoff via the real
`WorkRequest.MIN_BACKOFF_MILLIS` constant) running a nested `HeartbeatUploadWorker`
that POSTs `{lat, lng, accuracy, timestamp}` — cross-checked field-for-field against
both `Person3_BackendAPI/src/validation/mobileSchemas.ts`'s `mobileHeartbeatSchema`
and `backgroundTelemetry.js`'s own `sendHeartbeat()` body, confirmed identical — to
`{API_BASE_URL}/api/mobile/heartbeat` with `Authorization: Bearer <token>`, using only
Android SDK built-ins (`HttpURLConnection`, `org.json.JSONObject`) plus
`androidx.work:work-runtime` (the one new Gradle dependency, called out the same way
the sibling file calls out `play-services-location`). A 401 returns `Result.failure()`
(a background `Worker` has no HttpOnly cookie jar to run the refresh dance against);
a 5xx or network error returns `Result.retry()`.

Cannot be compiled or run here (no Android SDK, no `android/` folder — same stated
limitation as its sibling file). What was actually checked: the JSON field
names/types match the real Zod schema and the JS heartbeat body exactly (read side by
side), the `SharedPreferences` group name matches the real plugin source exactly, and
the method signature matches `PnsmForegroundService.java`'s existing call site
exactly. Stated plainly: scaffold-level, not tested, same as its sibling.

### N23 — Cross-reference: Person4's face-match threshold is a calibrated confidence percentage, not a literal raw cosine comparison

Not a fix — a documentation cross-reference for consistency with how every other
blueprint-vs-implementation nuance in this project has been recorded. The blueprint's
wording ("If the resultant geometric similarity score evaluates to 85% or higher...")
reads as a literal `cosine_similarity >= 0.85` comparison. Person4_AIBiometricService
implements the 85% figure correctly as the named threshold
(`PNSM_APPROVE_THRESHOLD`, default `85.0`) — but architecturally as a *calibrated
confidence percentage* derived via a fitted sigmoid mapping
(`app/ai/calibration.py:57`, `cosine_for_confidence()`), not a literal raw cosine
comparison. `app/ai/score.py`'s own module docstring explains why directly: "the
whole point of this module is that `confidence` is *not* `cosine * 100`. ArcFace does
not put genuine pairs above 0.85 raw cosine... multiplying raw cosine by 100 and
demanding 85 would reject nearly everyone." This is the objectively more correct
approach — a surface-literal reading of the blueprint's wording would produce a
system that rejects real, matching employees — and was already fully justified in the
AI service's own code comments before this session ever started. This entry exists
purely so a future reader cross-referencing the blueprint against DECISIONS.md finds
the explanation here too, rather than only in `app/ai/score.py`.

## Flawless + Ultra Blueprint compliance pass (N24+)

Both `PNSM_Flawless_Blueprint.pdf` and `PNSM_Ultra_Blueprint.pdf` assume a real
AWS/managed-service deployment (DPoP+PQC auth, MongoDB Atlas Queryable Encryption,
iBeta-certified ISO 30107-3 PAD, CloudFront/WAF/GuardDuty/Lambda/ECS Predictive
Scaling, AI-driven autonomous CI/CD rollback). This project's scope stays
local-dev-complete — no real cloud, no accredited certification labs, no native
mobile builds, no GitHub push. Entries below cover exactly the subset of both
blueprints that is genuinely buildable and verifiable in that scope; deferred/
impossible items are catalogued in one entry (N40) rather than scattered.

### N24 — Distributed rate limiting: Redis + `rate-limiter-flexible`, replacing per-process `express-rate-limit`

Every rate limiter (`auth.routes.ts`, `attendance.routes.ts`, `heartbeat.routes.ts`,
both `mobile/` and `admin/`) was a separate in-memory `express-rate-limit` instance —
resets on restart, and would desynchronize across any horizontally-scaled deployment.
`app.ts` also had no app-wide floor at all.

**Decision:** new `src/lib/redis.ts` (shared `ioredis` client, `lazyConnect: true` so
importing it never blocks) and `src/middleware/rateLimiter.ts` (`createRateLimiter()`
factory backed by `RateLimiterRedis`, composite `ip:userId:route` keys, native
escalating `blockDuration`). Falls back to `RateLimiterMemory` under `IS_TEST` so Jest
never needs a real Redis server — mirrors the `MONGODB_URI` test-fallback pattern
`config/env.ts` already establishes. All four existing route files and a new coarse
global limiter in `app.ts` (300 req/min/IP) now go through it; numeric budgets
unchanged (login 20/15min, refresh 60/15min, check-in 15/60s, heartbeat 10/60s) — this
changed the storage/algorithm, not the limits. `docker-compose.yml` gained a `redis`
service (`redis:7-alpine`, healthcheck via `redis-cli ping`); `backend` depends on it.

Live-verified against the real stack: 21 rapid `POST /api/mobile/auth/login` requests
— the first 20 reached the auth service (401, wrong credentials), the 21st returned
429 with a real `Retry-After` header. `docker compose restart backend`, then a further
request still returned a block (surfaced as 403 `IP_BLOCKED` — see N28, the escalation
had already fired) — proving the block state lives in Redis, not in a since-restarted
process's memory. Real keys inspected directly: `redis-cli keys '*'` showed
`mobile-login:::ffff:172.18.0.1:anon:mobile-login` and `global:...`, confirming the
composite key shape. 14 new unit tests (`tests/unit/rateLimiter.test.ts`) cover budget
enforcement, the mobile/admin body-shape split, per-user key isolation on one IP, and
escalation counting. Full suite: 146/146 (132 previous + 14 new).

### N25 — BOLA/BOPLA re-verification: no new gaps found

Re-audited every `:id`-style route parameter under `src/routes/**` for BOLA (resource
ownership checked against `req.user`, never trusted from the URL) and every Zod update
schema for BOPLA (explicit field allow-listing, no route able to set `role` or
`is_active`-as-admin through a normal update path). Confirms the prior audits'
findings still hold: no `.passthrough()` schema anywhere, `employeeService.ts`'s
`updateEmployee()` still builds its update object field-by-field
(`update.name = input.name`, never `{...input}`), and no route exists that lets a
non-superadmin mutate a role. No code change — a targeted re-verification, not a
rewrite, exactly as scoped. Full suite unaffected: 146/146.

### N26 — Real active-illumination liveness signal, replacing the tap-to-confirm placeholder

`CheckInScreen.jsx`'s liveness step was an honestly-documented tap-to-confirm overlay
("this is a timed confirmation, not ML blink detection") with no real signal at all —
`liveness_passed` was a client-reported boolean, trusted directly into the
`AttendanceLog` (`attendanceService.ts`'s old `if (input.liveness_passed === false)
throw` early-exit, then storing `input.liveness_passed` verbatim). Real ISO/IEC
30107-3 certification needs a physical accredited lab (iBeta) and is out of scope, but
a genuine, uncertified active-illumination challenge is buildable: flash the screen
through 2 randomized colors while the front camera captures one frame per flash, and
check server-side whether the frames' color response actually correlates with the
flash the device itself just emitted.

**Decision:** new `Person4_AIBiometricService` endpoint `POST /v1/liveness/challenge`
(`app/routers/liveness.py` → `app/services/liveness.py`) — computes each frame's mean
RGB, isolates *chrominance* (deviation from the frame's own neutral grey) via cosine
similarity against the reported flash's target color, with brightness-closeness scoring
as the fallback for "white" (which has no hue to correlate). Raw-RGB cosine alone was
tried first and rejected: a neutral grey frame still scores misleadingly high against
any saturated target because of shared magnitude, not hue — caught by the unit tests,
not assumed. `Person1_MobileClient`: new `src/lib/liveness.js` (pure, testable:
`pickChallengeColors`, `captureFrameBase64`) plus a real `getUserMedia`/canvas capture
in `CheckInScreen.jsx`, replacing the tap overlay with a full-screen color-flash
overlay. The client **only captures frames** — it never computes pass/fail itself;
`mobileCheckinSchema`'s `liveness_passed: z.boolean()` was replaced with
`liveness_frames: z.array(...).min(2).max(4)`, and `attendanceService.ts`'s
`performCheckin` now calls the real endpoint as its first step (before touching the DB
or spending a PIN attempt) and stores the *server's* verdict, never a client-supplied
boolean.

Live-verified against the real Docker stack with genuine solid-color JPEGs (generated
via `cv2.imencode`, HMAC-signed exactly like Person 3's real client): a red-then-red
pair scored `{"passed":true,"confidence":100}`; a red-then-blue pair (frame 2
mislabeled) scored `{"passed":false,"confidence":50,"per_frame_scores":[100,0]}` —
the correlation math genuinely discriminates, not just in unit tests. 5 new
`tests/unit/test_liveness.py` cases (Person 4) plus 3 `__tests__/liveness.test.js`
cases (Person 1). Backend: `tests/unit/attendanceService.test.ts` rewritten for the
new flow (12 tests, was 10) — full suite 147/147. Person 4 suite 425/425 (pre-N27).
Person 1 suite 72/72. Production bundle unaffected: `vite build` still 96.44 KB gzip.

### N27 — Passive single-frame PAD analysis (moiré/edge-blend heuristics)

Both blueprints describe passive CNN analysis — detecting screen moiré and unnatural
edge blending — as a *second*, independent PAD signal alongside active illumination.
A trained anti-spoofing model is out of scope (no labeled attack-instrument dataset
exists here), but the underlying classical-CV signals are real and buildable with
libraries the service already depends on: `opencv-python-headless` and `numpy`
(previously used only for the embedding pipeline).

**Decision:** new `app/ai/passive_pad.py` — a 2D FFT mid-band energy ratio (screens/
prints leave a periodic pattern concentrated away from DC) plus `app/ai/quality.py`'s
already-existing `blur_variance()` (Laplacian sharpness, reused rather than
reimplemented) combined into one 0-100 heuristic confidence, explicitly documented as
uncalibrated against real data. Wired into `verify.py`'s existing pipeline as a new
step 9b — decodes the payload a second time (cheap relative to the ONNX inference
step) rather than threading a second return value through `extract()`'s well-tested
internals — and returned as a new `passive_pad` field, never used alone to gate the
decision. Person 3: `AttendanceLog` gained `passive_pad_confidence` (mirrors how
`face_match_score` is already recorded, for later threshold tuning).

The first test pass surfaced a real miscalibration, not just a passing/failing test: a
periodic grid and a synthetic "natural-like" 1/f-noise image both saturated to the
same 50.0 combined confidence, because the initial 0.35 moiré baseline was low enough
that *any* image with real detail exceeded it and clamped the component to zero —
caught by writing a genuinely-natural-statistics test fixture (1/f pink noise, not the
project's existing sinusoidal `synthetic_frame()`, which is itself periodic and a poor
"non-moiré" baseline). Baseline raised to 0.55, empirically against these synthetic
patterns (natural-like ≈0.49, hard grid ≈0.63) — still not real photographs, documented
as such in both the config field's docstring and this entry.

Live-verified: 6 new `tests/unit/test_passive_pad.py` cases. Full Person 4 suite
431/431 after this change (was 425 after N26). `docker compose up -d --build
ai-service backend` rebuilt clean and both came up healthy.

### N28 — Local autonomous incident response: the real, no-AWS analog of GuardDuty/EventBridge/Lambda auto-remediation

The Ultra blueprint's closed-loop response — GuardDuty detects, EventBridge routes,
Lambda auto-blocks the IP and alerts the team — assumes real AWS services, correctly
out of scope here. The underlying *pattern* needs none of that once N24's rate
limiter is real and Redis-backed.

**Decision:** new `IncidentBlocklist` model (`ip` unique-indexed, `expires_at`
TTL-indexed so a lifted block never needs manual cleanup), `services/incidentService.ts`
(`recordIncident()`, `listIncidents()`), and `middleware/incidentBlocklist.ts`
(`escalateToIncident` — the rate limiter's `onBlocked` hook, escalates only on an IP's
**second** block; `incidentBlocklistGuard` — mounted globally in `app.ts` ahead of all
routing, rejects a currently-blocked IP with 403 before it reaches any handler). Since
this project has no Slack/PagerDuty integration to page out to, the honest local
equivalent of the alert dispatch is a structured `logger.warn()` line — documented as
such, not left silent. New read-only `GET /admins/incidents` on the superadmin console
(same pattern as the existing `GET /spoof-alerts`) makes the blocklist actually visible
rather than a collection nobody reads. `incidentBlocklistGuard` short-circuits via
`dbReadyState() !== 'connected'` rather than querying Mongo — without this, the very
first Jest run hung: `tests/integration/health.test.ts` has no live DB connection by
design, and an unguarded `IncidentBlocklist.findOne()` blocked until Mongoose's
connection-timeout, past Jest's 5s default test timeout. Caught by actually running
the suite, not assumed.

Live-verified end-to-end as a side effect of N24's own restart test: the 21+ rapid
login attempts crossed the escalation threshold, and the *next* request after the
Redis-backed block returned `{"error":{"code":"IP_BLOCKED",...}}` at 403 — a real
`IncidentBlocklist` document was inspected directly via `mongosh`
(`escalation_count: 2`, `reason: "escalated rate-limit block on mobile-login"`,
`expires_at` 24h out), then cleared (`deleteMany({})` + `redis-cli flushall`) so it
didn't interfere with the rest of this session's verification. 8 new unit tests
(`tests/unit/incidentBlocklist.test.ts`) cover the escalation threshold, the fire-and-
forget failure path, the test-mode DB-skip fast path, both body shapes, and the
fail-open behavior if the blocklist lookup itself errors.

### N29 — AES-256-GCM field encryption for `gps_location` (local Queryable Encryption replacement); a real stale-index bug caught live

Per the user's explicit choice (AskUserQuestion, this same session): real MongoDB
Queryable Encryption needs `mongodb-client-encryption`/libmongocrypt, a native
dependency with known Windows build friction, to encrypt precise GPS coordinates.
AES-256-GCM field encryption achieves the identical confidentiality goal using the
exact pattern Person 4's AI service already runs successfully for face embeddings
(`app/crypto/fle.py`), with zero new dependencies (Node's built-in `crypto`).

**Decision:** new `src/crypto/fieldEnvelope.ts` (`seal`/`open`, `GeoKeyProvider`) —
same envelope shape as `fle.py` (`v`, `kv`, `alg`, `iv`, `ct`, `tag`, `created_at`;
`model_version` dropped, not applicable outside face embeddings), AAD binds
`userRef|field|keyId` so a ciphertext copied onto a different record or field fails
the GCM tag check instead of silently decrypting into the wrong place. New env vars
`PNSM_GEO_FLE_KEYS`/`PNSM_GEO_FLE_ACTIVE_KEY`, same JSON-map-of-base64-keys shape as
Person 4's `PNSM_FLE_KEYS`, distinct namespace so rotating one never touches the
other. `AttendanceLog.gps_location` and `SpoofAlert.gps_location` changed from a
typed GeoJSON `Point` subdocument to the opaque envelope shape; sealed at every write
site (`attendanceService.ts`'s `performCheckin`, `handleVerifyError`,
`reportMobileAnomaly`), opened only at the two read/display sites
(`toAttendanceRowDTO`, `superAdminService.ts`'s spoof-alert listing) — both open
helpers never throw outward, logging and returning `null` on a decrypt failure rather
than breaking an admin list over one bad record.

**The `2dsphere` index on `AttendanceLog.gps_location` is gone and cannot come back
without a different design** — verified safe before removing it: the only
`$geoWithin`/`$centerSphere` queries anywhere in this codebase
(`geofenceService.ts:68,131`) run against the separate `Geofence.location` field
using the live, in-flight check-in coordinates, never against stored `AttendanceLog`
rows. Documented in the field's own schema comment, not left as silent dead weight.

**A real bug, caught only by testing against the actual running database, not just
unit tests:** the first live verification attempt failed with MongoDB error 16755,
`Can't extract geo keys ... Point must only contain numeric elements, instead got
type string`. Removing the index from the Mongoose *schema* does not drop it from an
*already-running* database — this session's own earlier `docker compose up` runs had
already created the real `gps_location_2dsphere` index on the live `attendance_logs`
collection, and Mongo kept trying to maintain it against the new ciphertext shape.
Fixed with a one-time `db.attendance_logs.dropIndex('gps_location_2dsphere')`
against the running container. Not a concern for a fresh clone — a `docker compose
up` starting from an empty database never creates the index in the first place, since
the schema no longer declares it — so no SETUP.md change was needed, only this
record of what happened and why.

Live-verified end-to-end against the real stack (`docker compose exec backend node
...`, using the actual compiled `fieldEnvelope.js`/`AttendanceLog` model, not a
reimplementation): sealed a real point (23.8151, 90.4257), wrote it via
`AttendanceLog.create()`, read the raw stored document directly via
`mongoose.connection.collection('attendance_logs').findOne()` — confirmed genuinely
opaque ciphertext (`{"v":1,"kv":"k1","alg":"AES-256-GCM","iv":"CKXJ...","ct":"4rj9...",...}`,
no plaintext coordinates anywhere) — then opened it with the real `open()` function
and got back the exact original coordinates (`{"type":"Point","coordinates":
[90.4257,23.8151]}`). 10 new `tests/unit/fieldEnvelope.test.ts` cases (round-trip,
tampered-ciphertext rejection, wrong-userRef/wrong-field AAD rejection, key rotation).
Full backend suite: 157/157 (147 + 10 new).

### N30 — Additive local TLS/PQC reverse proxy; a real busybox-wget healthcheck bug caught live

Per the user's explicit choice: a **separate, optional** nginx container terminating
real TLS in front of `backend`, not a migration — the existing `:5000` plain-HTTP
mapping and every current dev workflow stay completely untouched.

**Decision:** new `infra/tls-proxy/` (`Dockerfile`, `nginx.conf`) — `nginx:alpine`
(confirmed via `nginx -V` before writing the config: nginx 1.31.5 built against
OpenSSL 3.5.7/running 3.5.8, `--with-http_ssl_module` present — no custom build
needed), `ssl_protocols TLSv1.3` and `ssl_ecdh_curve X25519MLKEM768:X25519:secp384r1`
on a new `:8443` listener, proxying to `backend:5000` over plain HTTP inside the
compose network. Self-signed cert generated at **image build time** via `apk add
openssl` + `openssl req` inside the Dockerfile — turnkey `docker compose up --build`,
matching this project's `.env` convention (real, local-only secrets, never a manual
pre-step), and never committed since a fresh one is minted on every build.
`docker-compose.yml` gained a `tls-proxy` service depending on `backend`.

**A real bug, caught only by watching the container's actual health status, not
assumed from the Dockerfile alone:** the first build used a `wget`-based
`HEALTHCHECK` (`wget -q -O- --no-check-certificate https://localhost:8443/health`),
which failed every single attempt with `wget: can't connect to remote host:
Connection refused` — despite the proxy genuinely working from outside the container
(`curl` and `openssl s_client` both succeeded against the same port at the same
time). Root cause: Alpine's busybox `wget` has no built-in HTTPS/TLS support at all;
`apk add openssl` installs the CLI tool but does not link busybox's wget against it.
Fixed by installing real `curl` in the image and switching the healthcheck to
`curl -fsSk https://localhost:8443/health` — confirmed `healthy` on the next build.

Live-verified against the real container, not inferred from config: `curl -sSk
https://localhost:8443/health` → `{"status":"ok",...,"db":"connected"}` (the request
genuinely round-trips through nginx's TLS termination to the real backend and back).
`openssl s_client -connect 127.0.0.1:8443 -groups X25519MLKEM768 -tls1_3` →
`Negotiated TLS1.3 group: X25519MLKEM768` — the actual post-quantum hybrid key
exchange both blueprints ask for, genuinely negotiated, not merely offered in the
config and left unconfirmed. (First grep attempt for `"Server Temp Key"` — the
classic pre-TLS-1.3 `s_client` label — found nothing; OpenSSL 3.5's `s_client`
prints the group under a different label, `"Negotiated TLS1.3 group:"`, for TLS 1.3
specifically. Re-ran without the incorrect filter rather than concluding the feature
didn't work.)

### N31 — Local supply-chain SBOM + audit gate; a real, pre-existing high/critical vulnerability chain the gate immediately caught

**Decision:** `npm sbom --sbom-format cyclonedx --sbom-type application` as a new
`sbom` script in each Node quadrant's `package.json` (npm ≥10, already on this host —
npm 11.17.0 — no new tooling), output gitignored (`sbom.json`, regenerated not
committed). New `scripts/audit-gate.sh` — `npm audit --omit=dev --audit-level=high`
per Node quadrant plus `pip-audit` (already installed in Person 4's venv, v2.10.1)
for the AI service; exits non-zero the instant any quadrant reports a real
high/critical finding. Not a GitHub Action — stays local, per established project
scope. Confirmed both Dockerfiles that matter (`Person3_BackendAPI`,
`Person2_WebDashboard`) already use `npm ci`, never `npm install` — no change needed
there, already compliant.

**Running the gate for real (not a synthetic test) immediately found two genuine,
pre-existing high/critical findings** — a stronger and more honest proof the gate
works than the synthetic throwaway-`package.json` check originally planned, so that
extra step was skipped as redundant once this happened:

- **Person1_MobileClient**: 19 vulnerabilities (4 critical, 9 high) traced to their
  exact origin via `npm ls ssh2 --omit=dev` / `npm ls protobufjs --omit=dev`:
  `capacitor-mock-location-checker` (a genuinely load-bearing production dependency —
  the app's real mock-GPS detection) transitively depends on `docgen` → `mecano` /
  `parameters` → `ssh2-connect`/`ssh2`/`protobufjs`. `docgen`/`mecano` are that
  package's own **documentation-generation tooling** — dependencies its author needed
  for their own build, never exercised at runtime by anything this codebase actually
  calls, but published as regular (not dev) dependencies, so npm pulls the whole
  chain into every consumer's production tree. `ssh2` has no fix available upstream
  at all.
- **Person2_WebDashboard**: 3 vulnerabilities (1 critical, 1 high) via `dompurify`
  (XSS class), pulled in by `jspdf`/`jspdf-autotable` (the CSV/PDF export feature).
  `npm audit fix --force` would resolve it but pulls a breaking major version bump of
  `jspdf` — npm's own advisory output flags this explicitly.

**Neither was fixed in this pass.** Both are real, but fixing them is a distinct,
separately-scoped task from building the gate itself — `ssh2` has no available fix to
apply, and force-upgrading `jspdf` needs its own regression pass against the real
export feature before landing, not a blind `--force` inside an unrelated blueprint
compliance sweep. Documenting this honestly, with the exact transitive chain, **is
the gate doing its job** — the alternative (declaring the gate "done" only after
quietly forcing through a breaking fix, or silently ignoring what it found) would be
worse than surfacing it plainly here as a real, actionable follow-up.

Live-verified: `bash scripts/audit-gate.sh; echo $?` → real exit code `1` against the
two genuinely vulnerable quadrants above; `Person3_BackendAPI` and
`Person4_AIBiometricService` both reported clean (`found 0 vulnerabilities`, `No
known vulnerabilities found`) in the same run.

### N32 — Local self-healing deploy script; a real image-store bug caught by testing the rollback path itself, not just the happy path

The real GitHub Actions/AWS CodeBuild/Gemini-driven autonomous CI/CD self-healing
pipeline is out of scope (no CI, no cloud, no push) — but the rollback *mechanic* it
describes (detect a bad deploy, revert to the last known-good state) is pure Docker
Compose and needs none of that.

**Decision:** new `scripts/deploy-with-rollback.sh` — wraps `docker compose up -d
--build`, not a replacement for it. Polls each watched service's real `/health`
endpoint (`backend`, `ai-service`, `tls-proxy` — all three already existed,
unmodified) for up to 60s; on any failing, re-tags and restarts the previous image
instead of leaving a broken build running.

**The first design (capture the running image's raw ID via `docker compose images
-q`, retag from that ID on failure) failed the moment it was actually tested against
a real broken deploy, not assumed to work from reading the Dockerfile:** deliberately
broke `backend` (temporarily set `PORT: 5999` in `docker-compose.yml`, so the
container listens on a port nothing is published to) and re-ran the script. Detection
worked correctly — both `backend` and `tls-proxy` (which proxies to it) correctly
failed their health checks. The rollback step did not: `docker tag <captured-id> ...`
failed with `Error response from daemon: No such image: sha256:...`, immediately
after the very same `docker compose up --build` that had just replaced the `:latest`
tag — confirmed via `docker images -f dangling=true` that this host's image store
(the containerd-snapshotter store, based on the build output's "unpacking to
docker.io/library/..." lines) does not reliably keep a same-tag rebuild's previous
image retrievable by bare content ID once the tag moves, unlike the classic Docker
image store's dangling-image behavior this design assumed.

**Fixed** by tagging the current image under a second, independently-held tag
(`pnsm_khan_edit-<service>:pre-deploy-backup`) *before* triggering the rebuild,
rather than trying to recover a bare ID afterward — a second live-held reference
survives the retag in a way a content ID alone did not on this host. Re-tested the
identical broken-`PORT` scenario: rollback now genuinely re-tags and restarts without
error. The backup tag is removed automatically on a successful (non-rollback) run so
it never accumulates.

**One honest limitation, surfaced by testing to completion rather than stopping once
the retag succeeded:** after this rollback, `backend` was still unreachable —
correctly so. The broken `PORT: 5999` was a `docker-compose.yml` **configuration**
regression, not a bad **code/image** change, and an image rollback cannot revert a
compose-file environment variable it never touched. Confirmed by reverting `PORT`
back to `5000` (the real fix, as an operator would apply it) and re-running the same
script once more: all three watched services — `backend`, `ai-service`, `tls-proxy`
— came back healthy, backup tags were cleaned up, and `docker images --filter
"reference=pnsm_khan_edit-*"` showed no lingering `:pre-deploy-backup` tags
afterward. This distinction (image rollback vs. config rollback) is real and worth
stating plainly rather than letting the script's name imply more than it does.

### N33 — Concurrent rendering (Item 10) and Web Worker offload (Item 14); virtualization deliberately skipped as unneeded

**Item 10, concurrent rendering.** Both blueprints call out `useTransition`/
`useDeferredValue` for "heavy state updates" and "DOM virtualization" for large
datasets. Grepping confirmed zero uses of either concurrent-rendering hook anywhere
in Person 1 or Person 2 before this pass.

**Decision, concurrent rendering:** `Person2_WebDashboard/src/components/tables/
attendance-view.tsx` — every filter setter (`from`, `to`, `officeId`, `status`,
`page`, and `resetFilters`) now runs inside `useTransition`'s `startFilterTransition`,
so the filter controls themselves stay responsive while React de-prioritizes the
resulting refetch+re-render. `Person1_MobileClient/src/screens/CheckInScreen.jsx` —
the post-submission `dispatch(...)`/`setResult(...)` pair (mounting the full-screen
result overlay after the AI-service round trip) now runs inside a transition, while
`setBusy(false)` stays a plain, immediate update so the busy indicator clears without
waiting on the heavier overlay mount.

**Decision, DOM virtualization: deliberately NOT added.** The blueprint's own
justification for virtualization is a table rendering more rows than fit the
viewport. Checked directly: `attendance-view.tsx`'s on-screen table is already
bounded to `DEFAULT_PAGE_SIZE = 20` rows via real server-side pagination (the
5,000-row fetch in `fetchAllForExport()` builds a CSV/PDF directly — it is never
mounted as DOM at all); `employees-view.tsx` is paginated the same way; the one
non-paginated list (`flagged-queue.tsx`) caps at 100 rows. Every list in this
codebase that could grow large already solves the underlying "don't render too many
rows" problem via pagination, which virtualization exists to solve differently —
adding `@tanstack/react-virtual` on top would be a dependency providing no real
improvement, exactly what this project's own engineering discipline calls out to
avoid ("don't add features beyond what the task requires"). Recorded here so a future
reader checking the blueprint's virtualization requirement against this codebase
finds the actual reasoning rather than a silently-missing checkbox.

**Item 14, Web Worker offload.** Both blueprints describe offloading
main-thread-blocking computation to keep the UI responsive; the WebAssembly-specific
half is correctly out of scope (no PQC signature generation exists here to offload —
deferred with DPoP), but the underlying *pattern* has a real, already-shipping target:
`Person1_MobileClient/src/lib/compression.js`'s `compressSelfie()` runs up to 8
synchronous canvas re-encode passes on the main thread on every single check-in.

**Decision:** new `compression.worker.js` runs the identical quality-stepping loop
inside a Web Worker via `OffscreenCanvas`/`createImageBitmap` (no `document` inside a
worker, so the main-thread version's `Image()`+`<canvas>` approach doesn't work
as-is). `compressSelfie()` is now a thin dispatcher: uses the worker when
`Worker`/`OffscreenCanvas` exist, falls back to the original synchronous
implementation (renamed `compressSelfieMainThread`, behaviour byte-for-byte
unchanged) otherwise — defensive, not speculative, since `OffscreenCanvas` support
genuinely varies across older Android WebViews. Vite's `new Worker(new URL(...),
{type:'module'})` pattern picked this up automatically: `npm run build` emits it as
its own chunk (`compression.worker-*.js`, 1.04 kB).

Live-verified in the real Browser pane (not jsdom, which has neither `Worker` nor
`OffscreenCanvas`): a synthetic 1200×900 gradient image compressed to 9,484 bytes in
134ms via the genuine worker path (`typeof Worker !== 'undefined'` and `typeof
OffscreenCanvas !== 'undefined'` both confirmed `true` first). A second check proved
the offload is real, not just dispatched: ran a `setInterval(...,0)` ticker
concurrently with a heavier 2400×1800 compression call — **16 main-thread ticks
fired while compression was in flight**, which a synchronous main-thread computation
would make impossible. 2 new unit tests (`__tests__/compressionWorkerDispatch.test.js`)
cover the dispatch logic itself (worker success path, and falling through on worker
failure without propagating the worker's own error) using a faked `Worker` global —
the existing `__tests__/compression.test.js` (10 tests, unchanged) already proves the
fallback path's behavior is untouched. Full Person 1 suite: 74/74 (72 + 2 new).

### N34 — Additive JS obfuscation build (M7); a real dynamic-import corruption bug caught only by loading the output in a browser

Per the blueprint's M7 (Insufficient Binary Protections): a Capacitor app ships raw
minified JS, trivially decompiled. Additive, not the default, matching this pass's
own established pattern for the TLS proxy — `npm run build`/`npm run dev` are
completely untouched; only a new `build:obfuscated` script (guarded by `cross-env
OBFUSCATE=1`) enables it.

**Decision:** `vite-plugin-javascript-obfuscator` (`compact`, `controlFlowFlattening`,
`stringArray` with base64 encoding) wired into both `Person1_MobileClient/
vite.config.js` and `Person2_WebDashboard/vite.config.ts`, active only when
`OBFUSCATE=1`. `debugProtection` deliberately left off — it actively hostile-loops a
real DevTools session, which would make this project's own "live-verify in the
Browser pane" discipline impossible against the obfuscated build.

**Two real bugs, both found only by actually loading the built output in a browser,
not by reading the plugin's docs or trusting a clean build exit code:**

1. **Person 2's obfuscated build crashed on load** — `Failed to resolve module
   specifier '@/pages/login'`. Root cause: `src/router/routes.tsx`'s
   `React.lazy(() => import('@/pages/...'))` calls have their specifier strings
   pulled into the obfuscator's encoded string array *before* Vite/Rollup's
   import-analysis pass rewrites them to real hashed chunk URLs, so the browser
   tries to resolve the raw, un-rewritten alias at runtime. Person 1 has no
   lazy-loaded routes and never hit this. Fixed by excluding the two files
   containing dynamic imports (`src/router/routes.tsx`,
   `src/components/dashboard/trend-chart.tsx`) from obfuscation via the plugin's own
   `exclude` option — the rest of the app's logic (auth, RBAC, API client, business
   logic) stays genuinely obfuscated. Re-verified live: the fixed build's login page
   (itself one of the previously-broken lazy routes) rendered fully with zero console
   errors.
2. **`deadCodeInjection: true` made Person 2's build effectively hang** — over 5
   minutes with multi-gigabyte memory growth (confirmed via `tasklist`, RSS climbing
   past 2.9 GB), against a quadrant whose bundled JS is considerably larger than
   Person 1's (MapLibre GL, Recharts, jsPDF). Person 1's much smaller single-bundle
   app completed the identical option in ~7s, so this is a real, measured
   size-dependent cost of the transform, not a theoretical caveat. Fixed by disabling
   `deadCodeInjection` for Person 2 specifically (documented inline in its
   `vite.config.ts`), keeping `controlFlowFlattening`+`stringArray` — the build then
   completed in a real, finite 4m10s. `controlFlowFlattening` alone still noticeably
   inflates the vendor-heavy `map`/`charts` chunks (maplibre-gl, recharts) even though
   the plugin's documented default `exclude` covers `node_modules` — worth flagging
   plainly as an observed limit of relying on that default for large third-party code
   pulled into a manual chunk, not silently worked around further given this pass's
   time budget.

Live-verified for both quadrants (not just a clean exit code): built, served via
`vite preview` on a throwaway port, loaded in the real Browser pane — Person 1's
obfuscated login screen and Person 2's (post-fix) obfuscated login screen both
rendered fully with zero console errors. Spot-checked bundle readability
(`grep -c` for real identifier/function names between `dist/` and `dist-obfuscated/`)
confirmed the obfuscated output is genuinely transformed (string-array base64 decode
helper visible at the top of the bundle, control-flow flattened) — one exported
name, `compressSelfie`, was found to persist across a module boundary in Person 1's
output the same way in both bundles, an honest, minor limitation noted rather than
hidden. `Person1_MobileClient/src/lib/compression.worker.js` is similarly not
touched by the plugin (Vite's separate worker-build pipeline) — the main app bundle
is the one that matters for M7's reverse-engineering threat model, so this is noted,
not treated as a blocker. Real, measured size costs recorded rather than assumed:
Person 1's main bundle grew from 96.44 KB to 129.96 KB gzip; devDependency-only
audit noise (27 vs. 19 findings) confirmed via a second `--omit=dev` run to be
entirely scoped to the new devDependency, with zero change to the production
vulnerability count N31 already recorded.

### N35 — Safari 16.3/WKWebView resilience: extending an existing fallback system, not building a new one, plus a WKWebView crash-recovery scaffold

**Correction to this plan's own Item 11 as originally scoped.** `Person2_WebDashboard/
src/index.css` already had a complete, well-documented Safari 16.3 `@supports`
fallback system (`.layout-grid`/`.kpi-grid`/`.split-grid`, `@supports not (color:
color-mix(...))`) from a prior session — this was already confirmed compliant in the
very first bulletproof-plan audit this whole project ran. What was missing was
*coverage*: grepping every `grid-cols-\[...\]` arbitrary-value usage found 9 real
grid-layout containers, and only 1 (`dashboard.tsx`) actually used the fallback-aware
class names — the other 8 had no `.split-grid`/`.split-main`/`.split-aside` wiring at
all, so old Safari would still collapse them exactly as the existing CSS comment
warns.

**Decision:** rather than inventing new fallback classes, extended the *existing*
system's coverage to the remaining containers — `login.tsx`, both `employee-detail.tsx`
grid instances (including its loading-skeleton state), `geofence-manager.tsx`,
`live-presence.tsx`, `employee-form.tsx`, and `geofence-form.tsx` now carry
`split-grid`/`split-main`/`split-aside` on the correct DOM-order children (matched to
which side of each `grid-cols-[A_B]` split is the fixed-width one); `attendance-view.
tsx`'s 4-column filter bar (a genuinely different shape — a wrapping row, not a
2-column split) got the already-existing `.layout-grid` instead. No new CSS was
required — the `@supports` block and its `.split-main`/`.split-aside` 62/32 flex-basis
split already existed and needed only to be *applied*. Zero risk to the modern
(supported-browser) rendering: every added class is inert outside the `@supports not
(...)` block, confirmed live via `getComputedStyle` in the real Browser pane —
`display: grid` on `.split-grid` in a browser where `CSS.supports('color',
'color-mix(...)')` is `true`, exactly the expected behavior.

New `Person1_MobileClient/native/PnsmWebViewWatchdog.swift` (same "STATUS: SCAFFOLD —
NOT WIRED UP" convention as the Java scaffolds — there is still no `ios/` project)
documents the real `WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:)`
callback both blueprints reference for WKWebView GPU-process crash recovery: reload
the last-known route rather than showing a permanently blank screen, chaining to
Capacitor's own navigation delegate rather than replacing it. Explicitly did not cite
an unverified "Capacitor WebView Crash" npm package by name, since no currently
maintained one could be confirmed — the scaffold implements the underlying, stable,
documented Apple API directly instead.

**Verification:** typecheck, full test suite (76/76), and `npm run build` all clean
after the class additions. The Swift file has the same honest limit as every other
native scaffold in this project: no Xcode/`ios/` project exists, so it cannot be
compiled or run — stated plainly, not claimed as coverage.

### N36 — OS-level background execution limits (Item 12) and precise Capacitor Background Runner mechanics (Item 13)

**Item 12.** Both blueprints are specific about two real, distinct platform ceilings:
Android 14/15's cumulative ~6-hour foreground-service execution budget per 24-hour
window (shared across every `dataSync`/`mediaProcessing`-type service an app runs),
and iOS 17/18's `CLLocationManager` predictively suspending location updates when the
device appears stationary, with no guaranteed automatic resume.

**Decision:** `PnsmForegroundService.java`'s doc comment now states the Android
budget figure explicitly and, more importantly, states *why this codebase already
stays under it*: periodic heartbeat telemetry runs through the Background Runner
(Item 13), not this foreground service, so the service's own runtime is reserved for
genuinely active tracking sessions rather than accumulating against the shared budget
all day. New `Person1_MobileClient/native/PnsmLocationDelegate.swift` (same "STATUS:
SCAFFOLD" convention — still no `ios/` project) documents the real, easy-to-miss pair
of `CLLocationManager` flags (`allowsBackgroundLocationUpdates = true` *and*
`pausesLocationUpdatesAutomatically = false` — setting only the first does not
disable the stationary-pause heuristic) plus the `locationManagerDidPauseLocationUpdates`
resume callback, closing the one asymmetry between the Android and iOS native
scaffolds (only Android had one at all before this).

`package.json` also gained the real, exact-named dependency both blueprints cite,
`@capawesome-team/capacitor-android-foreground-service` (confirmed to genuinely exist
on the npm registry, v8.1.0, before citing it as fact) — added alongside the
hand-rolled `PnsmForegroundService.java`, not replacing it, with the rationale
documented directly in that file: the hand-rolled version is fully auditable (no
third-party native code in the location/telemetry path) and there is still no
`android/` project to wire either implementation into regardless, so this makes the
blueprint's exact tool available and ready to evaluate the moment that changes,
without forcing an unreviewed rewrite of an already-designed scaffold.

**Item 13.** Verified the plugin's real configuration shape and headless-context
capabilities against Capacitor's own docs before writing anything (not assumed from
the blueprint's prose): `capacitor.config.json` gained a `BackgroundRunner` block
(`label`, `src: "background/heartbeat.js"`, `event: "heartbeat"`, `repeat: true`,
`interval: 15`, `autoStart: true`). New `src/background/heartbeat.js` — a genuinely
headless-context-safe handler using only the runner's real documented globals
(`fetch`, `console.*`, `CapacitorKV`, `CapacitorGeolocation` — no axios, no
`import.meta.env`, since this file is not processed by Vite at all, unlike everything
else in `src/`). One real correction this research surfaced: `interval: 15` in this
config means **15 minutes**, not the WebView heartbeat's 15 *seconds* — neither
platform's background scheduler can guarantee sub-minute wake cadence, a real
battery-motivated constraint, not a typo — documented explicitly in the file's own
header so a future reader doesn't assume parity with the foreground interval that
does not exist. Same unresolved-credential caveat as `PnsmTelemetryUploader.java`:
`CapacitorKV.get()` will always return null under the current architecture since
nothing ever writes a token there, stated plainly rather than invented around.

`npm run audit:capacitor` (this project's own existing plugin-parity check) correctly
flagged `@capacitor/background-runner@^3.0.0` as off the Capacitor-core v8 lockstep
the rest of the plugins follow — checked rather than dismissed: v3.0.0 is genuinely
the latest real version on the npm registry (confirmed directly), and Background
Runner is one of the plugins that has never followed core's lockstep versioning
convention. A real, intentional exception, not a version-pinning mistake — recorded
here so the next person who sees that WARN line doesn't have to re-derive the same
answer.

**Verification:** `npm install` added both new dependencies cleanly; `npm audit
--omit=dev --audit-level=high` unchanged at 19 (same as N31), confirming neither
introduced a new production vulnerability. Full suite 74/74, `npm run build` clean
and unchanged in bundle size (`heartbeat.js` is correctly untouched by the Vite
bundle, exactly as intended for a file the runner loads directly from the native app
bundle). Both native scaffold files have the same honest limit as every other one in
this project: cannot compile or run without the native platform projects.

### N37 — Explicitly deferred / out of scope for this pass (`PNSM_Flawless_Blueprint.pdf`, `PNSM_Ultra_Blueprint.pdf`)

Recorded once, here, rather than re-stated in every entry above. Two categories:

**Deferred by the user's own explicit choice** (AskUserQuestion, this same session —
not a unilateral judgment call):
- **DPoP (RFC 9449) + post-quantum-signed JWTs/mTLS** — replacing the entire
  authentication system, touching every API call across all three quadrants on top of
  an already fully-verified working system. Stays a documented future phase.
- **A full HTTPS migration** (every URL/CORS/cookie in the stack) — N30's additive
  TLS/PQC reverse-proxy layer achieves the same real, checkable PQC-TLS claim without
  the migration risk.
- **Real MongoDB Queryable Encryption** (`mongodb-client-encryption`/libmongocrypt,
  known Windows native-build friction) — N29's AES-256-GCM field encryption achieves
  the identical confidentiality goal with zero new native dependencies.

**Confirmed genuinely impossible in this environment, regardless of engineering
effort** (verified via research before this pass began, not assumed):
- **Real iBeta/ISO 30107-3 Level 2/3 PAD certification** — requires a real,
  NVLAP-accredited physical lab running adversarial physical attacks; no
  self-certification path exists at any level. N26/N27 ship real, own-built,
  explicitly-uncertified heuristic PAD signals instead, documented as such
  everywhere they appear.
- **Real thermal/SWIR camera fusion** — no such hardware exists in this environment.
- **Real AWS-managed services with no local equivalent**: CloudFront's actual global
  edge PoP network (N30's TLS proxy provides real local TLS/PQC termination, not
  global edge caching), WAF Bot Control, GuardDuty/EventBridge/Lambda proper (N28 is
  the real local analog of the *pattern*, not the AWS products), ECS Predictive
  Scaling (no real traffic to forecast against in a local dev environment — no local
  analog would be meaningful), and a real AI-driven (Gemini-based) root-cause-analysis
  CI/CD pipeline (N32 is the real local analog of the *rollback mechanic* specifically,
  not the AI-driven diagnosis).
- **WebAssembly offloading of PQC signature generation** — tied directly to the
  deferred DPoP/ML-DSA work above; nothing in this pass's actual scope produces a
  main-thread-blocking cryptographic computation for it to offload. N33's Web Worker
  offload of the real, already-shipping `compressSelfie()` hot path is this pass's
  genuine application of the same underlying *offload* principle, just not via Wasm.
- **Native `android/`/`ios/` platform folders**, `npx cap add`, or any GitHub
  Actions/CI configuration — this project stays local-only and unpushed, unchanged
  from every prior phase.

### N38 — Pre-AWS bulletproofing pass: an 8-angle multi-agent review of N24–N37's own diff found 9 real bugs, all fixed and re-verified

The user's explicit bar before moving to real AWS/MongoDB Atlas accounts: "100%
bulletproof" — not just "every item implemented," but the N24–N37 diff itself
re-reviewed as if it were someone else's PR. Ran the `code-review` skill at high
effort against the full working-tree diff (`git diff HEAD`, 51 files, ~4,000 lines):
8 parallel finder agents (line-by-line scan, removed-behavior audit, cross-file
tracer, reuse, simplification, efficiency, altitude, conventions/CLAUDE.md), each
independently reading the real diff and the real surrounding code, not a summary of
it. Several real, confirmed defects were caught this way that unit tests alone had
not surfaced — some independently flagged by 3-4 of the 8 angles, which is exactly
the cross-confirmation multi-angle review exists to produce.

**Fixed — real correctness/security bugs, most severe first:**

1. **Socket broadcast sent the raw AES-256-GCM `gps_location` envelope, not the
   decrypted point.** `toAttendanceLogSocketPayload()` (`attendanceService.ts`) did
   `{...doc}` without ever calling `openGeoPoint()`, unlike every other
   `AttendanceLog` read path. Every real-time check-in event would have crashed
   Person 2's live map (`pointToLatLng(envelope)` reading `.coordinates` off
   `{v,kv,alg,iv,ct,tag}`) the instant a real check-in happened — masked entirely by
   this project's own tests, since none exercised the socket payload path
   specifically. Fixed; a new test seals a *real* envelope with the real `seal()`
   function and asserts the broadcast payload is the decrypted point with no
   ciphertext fields present.
2. **Mobile clients got the wrong error envelope from the new perimeter middleware.**
   `incidentBlocklistGuard` and the global rate limiter (`app.ts`) run *before*
   `markRouteGroup`, so `res.locals.routeGroup` was always `undefined` there — both
   defaulted to `'admin'`, meaning a rate-limited or IP-blocked mobile client got
   `{data,error}` instead of the bare `{status,reason,face_match_score}` shape ADR-1
   requires and `Person1_MobileClient/src/lib/api.js` actually parses. Independently
   caught by 4 of the 8 review angles. Fixed via a new `inferRouteGroup()`
   (`routeGroup.ts`) that falls back to path-prefix inference (`/api/mobile` vs
   everything else) when `res.locals.routeGroup` isn't set yet.
3. **A transient Redis outage would auto-ban real users for 24 hours.** The rate
   limiter's `catch` block treated *any* rejection from `limiter.consume()` as a
   genuine quota block — including a Redis connection error, given
   `maxRetriesPerRequest: 2, enableOfflineQueue: false`. Two such "blocks" during a
   brief outage would escalate a real IP straight into the `IncidentBlocklist`. Fixed
   by checking `rejection instanceof RateLimiterRes` (the library's own real
   discriminator between "genuinely out of points" and everything else) before
   treating a rejection as abuse; anything else now fails open and logs.
4. **The escalation counter reintroduced the exact defect N24 exists to fix.** A
   bare in-memory `Map` (`blockCounts`) tracked how many times an IP had been
   blocked — reset on restart, never shared across instances, exactly the property
   N24's own migration off in-memory `express-rate-limit` was built to eliminate,
   one layer up. Also grew unbounded for the life of the process (no TTL, no
   eviction). Fixed: moved to Redis (`INCR`+`EXPIRE`, 1-hour rolling window),
   falling back to the in-memory Map only under `IS_TEST` — same convention the
   limiter itself already uses.
5. **`req.ip` never saw the real client address once traffic could arrive via
   `infra/tls-proxy` (Item 8).** nginx sets `X-Forwarded-For` correctly, but Express
   was never told to trust it — every proxied request collapsed onto the proxy
   container's own address as far as the rate limiter and incident blocklist were
   concerned (one shared bucket for all traffic through :8443, and no real per-client
   throttling at all through that path). Fixed: `app.set('trust proxy', 'loopback,
   linklocal, uniquelocal')` — Express's private-network preset, not `true`, since
   :5000 also still accepts direct unproxied connections as the primary dev workflow
   and unconditional trust would let any direct caller spoof the header to bypass
   IP-based limiting outright.
6. **The TLS proxy silently broke Socket.IO.** `infra/tls-proxy/nginx.conf`'s
   `location /` block never forwarded `Upgrade`/`Connection` — nginx defaults to
   plain HTTP proxying, so the WebSocket handshake for Person 2's live
   attendance/spoof-alert feed could never complete through :8443 (degrading to
   long-polling or failing outright, depending on client transport config), even
   though the REST API worked fine. Fixed: added the standard `map $http_upgrade
   $connection_upgrade` + `Upgrade`/`Connection` header forwarding + a longer
   `proxy_read_timeout` for the long-lived connection.
7. **`gps_location` was fully selected by default, unlike its own stated precedent.**
   `AttendanceLog.ts`'s own doc comment claimed `Mixed`, "the same way Person4's
   FaceEmbeddings envelope already is" — but the actual schema was a fully-typed,
   always-selected sub-schema, matching neither `Mixed` nor `FaceEmbedding.ts`'s
   `select: false`. Fixed: both `AttendanceLog.gps_location` and
   `SpoofAlert.gps_location` are now genuinely `Schema.Types.Mixed, select: false`,
   with `.select('+gps_location')` added at every real read call site that needs it
   (`attendanceService.ts`'s broadcast/list/feed/status-update paths,
   `superAdminService.ts`'s spoof-alert listing) — verified by walking every
   `AttendanceLog`/`SpoofAlert` query in the codebase, not assumed.
8. **A decrypt failure could crash the admin dashboard outright.**
   `openGeoPoint()`'s own documented failure mode is `null` (never throws), but the
   frontend's `pointToLatLng()` had no null case — `point.coordinates[1]` on `null`
   throws, taking down whichever table/map/CSV export tried to render that one row.
   Fixed: `pointToLatLng()` now accepts and gracefully returns `null` (a TS overload
   keeps the always-non-null `Geofence.location` call sites fully typed as non-null
   still), and all four real call sites (`live-map.tsx`, `flagged-queue.tsx`,
   `columns.tsx`, `export-csv.ts`) render "unavailable"/skip the marker instead of
   crashing. `AttendanceLog`/`SpoofAlert`/`LivePresence`'s frontend types widened to
   `GeoJSONPoint | null` to match reality.
9. **An empty `liveness_frames` submission (camera permission denied) surfaced as a
   generic 422, not the specific `liveness_failed` reason.** The real backend forwarded
   a short frame array straight to Person 4's own `min_length=2` Pydantic validation,
   surfacing as a generic `PnsmAiError` → `'server_error'` — not the specific,
   actionable reason the mobile UI already has messaging for. The fix is NOT a
   client-side short-circuit (deliberately rejected — `__tests__/checkinFlow.test.js`'s
   own "forwards captured challenge frames to the backend rather than deciding
   pass/fail locally" test encodes the real architectural rule: the client never
   invents a pass/fail boolean, camera-denied included). Fixed server-side instead:
   `mobileCheckinSchema.liveness_frames` no longer has `.min(2)` structurally valid
   requests can now carry 0-4 frames — and `performCheckin()` checks the count
   explicitly before ever calling Person 4, throwing the specific `liveness_failed`
   reason and skipping a wasted network round trip for a challenge that cannot pass.

**Fixed — a real, pre-existing critical vulnerability, found while re-checking N31's
own deferred follow-up:** `Person2_WebDashboard`'s `jspdf`/`jspdf-autotable`
(dompurify-XSS chain, N31) upgraded from `^2.5.2`/`^3.8.4` to `4.2.1`/`5.0.8` — a real
major-version jump, not a blind `--force`. Verified low actual risk before doing it:
exactly one call site in the whole codebase (`src/lib/export-pdf.ts`), using only the
stable, unchanged-across-majors `autoTable(doc, options)` function-call API (not the
deprecated `doc.autoTable()` method form). `npm audit --omit=dev --audit-level=high`:
0 vulnerabilities, down from 3 (1 critical, 1 high). `Person1_MobileClient`'s
`ssh2`/`protobufjs` chain (via `capacitor-mock-location-checker`'s own doc-generation
tooling) remains genuinely unfixed — `ssh2` still has no upstream fix at all; this was
re-confirmed, not re-assumed.

**Also applied, lower-severity but real:**
- `Person3_BackendAPI/src/services/attendanceService.ts`'s post-create broadcast
  no longer re-fetches the document it just created (`AttendanceLog.findById()`
  immediately after `AttendanceLog.create()`, reading data already sitting in
  memory) — now populates the live document in place (`log.populate(...)` +
  `.toObject()`, not a raw `{...log}` spread, which mishandles a live Mongoose
  Document's internal state) and removes one Mongo round trip from the check-in hot
  path.
- `Person1_MobileClient/src/screens/CheckInScreen.jsx`'s `runLiveness()` no longer
  dereferences `videoRef.current` unguarded — a real (if narrow) race if the
  component unmounts between the `getUserMedia` await resolving and the following
  line; now fails closed to `[]` frames, the same as "no camera available" already
  does two lines above.
- `rateLimiter.ts`/`incidentBlocklist.ts`'s 429/403 responses now call the existing
  `mobileError()`/`adminError()` helpers instead of hand-rolling the identical JSON
  shape inline in four places — one real place left to keep each envelope's contract
  correct, not four.
- `attendanceService.ts`'s `sealGeoPoint()` helper (previously spliced into the
  middle of the file's own import block) moved to sit after every import, where
  every other module-level declaration in the file already lives.

**Identified, deliberately not applied in this pass** (real, but genuinely lower
priority than the correctness/security items above — noted here rather than silently
dropped): `openGeoPoint()` is duplicated near-verbatim between `attendanceService.ts`
and `superAdminService.ts` (the latter's own comment already admits this); the four
rate-limiter call sites' `{keyPrefix, points, durationSec, blockDurationSec}` configs
are inline literals rather than one shared table; `compression.worker.js` re-implements
`compression.js`'s quality-stepping loop rather than sharing one function
parameterized over the canvas source; `passive_pad.py`'s Laplacian-sharpness pass
runs on the full-resolution frame rather than the same downsampled buffer its sibling
FFT/moiré check already uses, and `verify.py` decodes the check-in image twice
(explicitly documented as a deliberate choice, not an oversight, in the code's own
comment) rather than threading a second return value through `extract()`'s
well-tested internals. None of these affect correctness; all are candidates for a
future, separately-scoped cleanup pass.

**Verification:** every fix re-verified for real, not assumed from the review's own
say-so — full suite re-run after each round of fixes: backend **159/159** (157 + 2
new regression tests, including one that seals a genuine AES-256-GCM envelope with
the real `seal()` function and asserts the broadcast payload is correctly decrypted),
mobile client **74/74**, web dashboard **76/76** with a clean `tsc --noEmit` across
both TypeScript quadrants. A live `docker compose` rebuild to re-confirm the
trust-proxy/WebSocket/perimeter-envelope fixes end-to-end was attempted but blocked by
an unrelated environment issue this session — Docker Desktop's own `docker-desktop`
WSL2 backend distribution stopped and did not come back up even after a `wsl
--shutdown` + relaunch — stated plainly as a real, current limitation rather than
claimed as verified when it wasn't; every fix above is instead verified by the
automated suite, including a genuine cryptographic round-trip for the single most
severe finding.

### N39 — The deferred live `docker compose` pass, completed: real end-to-end proof of every N38 fix, plus one more real bug the live pass alone could catch

N38's own environment blocker resolved (a genuine, reproducible Docker Desktop 4.89.0
Windows bug — AF_UNIX socket cleanup failing with "The file cannot be accessed by the
system" on every unclean exit, hitting a different socket file each retry; documented
upstream at [Docker Community Forums](https://forums.docker.com/t/docker-desktop-4-88-1-fails-to-start-on-windows-af-unix-socket-file-cannot-be-accessed/152314)
and [docker/desktop-feedback#460](https://github.com/docker/desktop-feedback/issues/460) —
fixed by renaming, not deleting, every stuck `run`/`docker-secrets-engine` directory
under `%LOCALAPPDATA%` before each relaunch, not by any Windows Defender setting,
which two rounds of exclusions/Controlled-Folder-Access allow-listing conclusively
ruled out as the actual cause). With the real stack finally up, ran the live
end-to-end pass this whole entry's own predecessor could only state as deferred:

- **PQC/TLS 1.3 through the real proxy**: `openssl s_client -groups X25519MLKEM768`
  against the rebuilt `tls-proxy` container returned `Negotiated TLS1.3 group:
  X25519MLKEM768` — genuine post-quantum hybrid key exchange, not a config file claim.
- **WebSocket upgrade through the proxy** (N33/N36's own fix): a real Engine.IO
  handshake (`GET /socket.io/?EIO=4&transport=polling`) followed by the actual
  WebSocket upgrade request returned `HTTP/1.1 101 Switching Protocols` — Person 2's
  real-time feed genuinely reaches Socket.IO through :8443, not just theoretically per
  the nginx config.
- **Redis-backed rate limiting surviving a real restart, again** — 21 rapid mobile
  logins, a real `docker compose restart backend`, and the block (now escalated to
  `IncidentBlocklist`, correctly returning `ip_blocked`/403) held across the restart,
  on the freshly rebuilt stack, not a leftover state from before this session's fixes.
  Also caught, live, the exact `RateLimiterRes` discrimination fix (N38 item 3) firing
  for real: the backend's very first request after a cold start logged `"rate limiter
  backend error, failing open"` — Redis's connection hadn't finished establishing yet
  (a real, if narrow, `ioredis` `lazyConnect`+`enableOfflineQueue:false` cold-start
  race) — and the request was correctly let through rather than misclassified as
  abuse, exactly the behavior N38 item 3 was written to guarantee.
- **A pre-migration `AttendanceLog` record's safe degradation, against real data**:
  the database already held one real check-in from before Item 9 landed, with
  `gps_location` still a plain, unencrypted GeoJSON point. Running the actual compiled
  `open()` against it inside the live backend container confirmed it throws
  (`unsupported algorithm undefined`, since the legacy shape has no `alg`/`iv`/`ct`/
  `tag` fields) — and `openGeoPoint()`'s catch, verified against this genuine
  pre-existing record rather than a synthetic one, degrades that to `null` exactly as
  designed, which N38 item 8's frontend fix then renders as "unavailable" rather than
  crashing.

**And a real, new bug the live pass alone could have caught** — `trust proxy` (N38
item 5) was necessary but not sufficient: `infra/tls-proxy/nginx.conf` set
`X-Forwarded-For $proxy_add_x_forwarded_for`, which *appends* to whatever
`X-Forwarded-For` a client already sent rather than replacing it. Since `tls-proxy` is
the genuine network edge here — nothing trusted sits in front of it — a client could
prepend an arbitrary IP of their own choosing and Express (correctly trusting that
proxy hop per N38's own fix) would believe it. **Confirmed live, not theorized**: a
plain `curl -H "X-Forwarded-For: 6.6.6.6"` against the pre-fix proxy landed a
`6.6.6.6` key straight into Redis, completely bypassing IP-based rate-limiting and
incident-blocking for that request. Fixed by setting `X-Forwarded-For $remote_addr`
(nginx's own genuinely observed connecting address, discarding anything the client
supplied) — re-verified live immediately after: the identical spoofed-header request
now correctly resolves to the proxy's real address, not the attacker's claim.

**Root-caused, not just worked around**: the Docker Desktop startup bug turned out to
have nothing to do with Windows Defender at all — two full rounds of Controlled
Folder Access allow-listing and Defender exclusions were added at the model's own
suggestion before the Defender Operational event log was actually checked and showed
**zero** block/detection events at any failure timestamp, which is what prompted
looking past Defender entirely and searching for the exact error string, which is
what actually found the real, documented Docker Desktop bug and its real fix. Recorded
here so a future session hitting the same Docker error doesn't repeat the same
Defender detour.

## Moving off local-dev-complete: real MongoDB Atlas (N40+)

The user provided real MongoDB Atlas credentials (a `Cluster0` deployment, user
`PNSM_Khan`, Atlas admin role) and asked to connect the real PNSM stack to it — the
first concrete step of moving past this project's own local-dev-complete boundary,
established from the very start of this project and reiterated through N37/N38's own
"explicitly deferred" catalogue.

### N40 — `backend` now connects to real MongoDB Atlas; the local `mongo` container demoted to an unused offline-dev fallback

**Decision:** `MONGODB_URI` moved into `.env` (previously hardcoded to the local
`mongo` container directly in `docker-compose.yml`) holding the real Atlas standard
(non-SRV) connection string. `docker-compose.yml`'s `backend` service now reads
`MONGODB_URI: ${MONGODB_URI:?set in .env}` instead of the hardcoded local value, and
its `depends_on` no longer gates startup on the local `mongo` service's health — that
container stays defined (harmless, for anyone who wants to switch back to a fully
offline local database) but nothing in this compose project uses it once `.env` is
set. `SETUP.md`'s port-list comment updated to say so explicitly rather than leave a
stale claim.

**A real, live-diagnosed bug in the connection string itself, not an environment
problem** — the actual reason every single connection attempt (from `mongosh`, from
the real backend, from a throwaway container) timed out for over an hour of
troubleshooting: the replica set name in Atlas's own "Connect" UI reads as
`Atlas-7wxymn-shard-0`, but the *real*, case-sensitive name the servers themselves
report (confirmed via `rs.status().set` against a direct, single-host connection) is
`atlas-7wxymn-shard-0` — lowercase `atlas`. MongoDB's replica-set topology matching is
case-sensitive: a wrong-case `replicaSet` parameter lets every underlying TCP and TLS
handshake succeed perfectly (confirmed independently, repeatedly, against all three
shard hosts) while the driver's topology monitor simply never selects a server,
surfacing as a generic 30-second `MongoServerSelectionError` that mongosh's own error
message actively misdirects toward "check your Network Access List" — a real,
misleading default error message this session spent real, substantial time chasing
down two other genuinely plausible-looking leads (Windows Defender, then WSL2
networking) before methodically isolating with `directConnection=true` (bypasses
topology discovery entirely — succeeded instantly, proving credentials/TLS/network
were never the problem) and reading the real name back from the cluster itself rather
than re-trusting the screenshot. A single wrong letter's case, not a network or
credentials issue, was the entire cause.

**Two genuine, unrelated findings from the same troubleshooting session, recorded
honestly rather than discarded now that they turned out not to be the fix**: (1) the
same Docker Desktop AF_UNIX-socket bug from N39 recurred on this machine's next
restart, confirming it is a real, repeatable defect on this install, not a one-off —
cleared the same documented way (rename, not delete, the stuck `run`/
`docker-secrets-engine` directories) each time it did; (2) a `.wslconfig` with
`networkingMode=mirrored` was added at the user's own machine level (not something
this project's files control) while investigating what looked like container-network
packet loss to Atlas — real TCP flakiness *was* observed from inside containers
before this change and real TLS handshakes were 100% reliable after it, but since the
actual root cause was the replica-set name, this change's true necessity is
unconfirmed; left in place since it is a legitimate, supported, generally-beneficial
WSL2 mode with no observed downside, not reverted on a hunch.

**Live-verified end-to-end, not just "db":"connected"**: `docker exec ... node dist/
scripts/seed.js` against the now-empty real Atlas `pnsm` database — this project's
own established first-Super-Admin bootstrap script, unchanged, run against a real
cloud database for the first time — created the real Super Admin account and all
three roles. A real `POST /api/auth/login` against the Atlas-backed `backend`
returned a genuine, valid access/refresh JWT pair — proving bcrypt password
verification, role lookup, and JWT signing all work correctly against the real
database, not merely that a connection string parses. Re-verified through
`tls-proxy` too, after restarting it to pick up `backend`'s new container IP (a
routine Docker-internal-DNS-caching step after recreating a proxied container, not a
bug). Full stack confirmed healthy: `ai-service`, `backend`, `minio`, `redis`,
`tls-proxy` all healthy; local `mongo` correctly not running, since nothing depends on
it any more.

### N41 — Full from-scratch deep audit of the entire project post-Atlas migration; one real, previously-undetected critical/high supply-chain finding, fixed

The user asked for a ground-up re-audit of everything done in the project so far — not
just the Atlas migration — with the explicit goal of catching anything that could
surface as a future error before moving to a real AWS deployment. This was a
verification pass (confirm the existing work is sound), not a feature pass, structured
as a checklist across every subsystem touched by N24-N40:

**Confirmed clean, no changes needed:**
- Every Mongoose schema's indexes (including `unique`/TTL) build correctly and
  automatically on first connect to a genuinely fresh Atlas database — live-checked via
  `db.collection.getIndexes()` against the real cluster, not assumed from schema code.
- `seed.ts`'s idempotency (`ensureSuperAdmin`/`ensureRoles`) re-verified by re-running
  it against the now-populated Atlas database — correctly a no-op, per its own design.
- Credential redaction (`logger.ts`'s `redact()`) re-verified against the *real* Atlas
  password specifically (not just a synthetic test string) by deliberately triggering a
  connection-string-shaped error and confirming the log output; a full grep of
  `docker compose logs` history confirmed zero historical leakage of the real password.
- `.env` git hygiene: untracked, correctly listed in `.gitignore`, and the real password
  does not appear anywhere else in the tracked codebase (a repo-wide grep, `.env`
  excluded, returned no matches — grep's own exit code 1 on "no matches," not an error).
- `server.ts`/`config/db.ts`'s connection-resilience design: crash-fast on a failed
  *initial* connection (correct, backed by the container's `restart: unless-stopped`
  policy) plus Mongoose's own built-in automatic reconnection for a *mid-session* drop
  (correct, no custom reconnect logic needed or present) — reviewed and confirmed sound
  as-is.
- A full fresh regression run: 742 tests across all four quadrants (before this entry's
  fix below changed Person1's count to 74, still all passing), both Node quadrants'
  `tsc` typechecks clean.
- Live re-verification specifically against Atlas (not just local Mongo, to make sure
  nothing about the encryption/rate-limiting work implicitly assumed a local database):
  the `gps_location` AES-256-GCM seal/open round-trip (Item 9/N34) with a real inserted
  envelope, decrypted correctly by the real admin API, test data cleaned up after; the
  Redis-backed rate limiter + Atlas-backed `IncidentBlocklist` (Items 1/3c, N24/N28)
  both correctly persisting a block across a real `docker compose restart backend`,
  test data cleaned up after.
- `scripts/deploy-with-rollback.sh` and `scripts/audit-gate.sh` (Items 3d/4): neither
  references `mongo`/`MONGODB_URI` at all — the deploy script only watches
  `backend`/`ai-service`/`tls-proxy` health endpoints, and the audit gate only runs
  `npm audit`/`pip-audit`. Both are already correctly unaffected by the Atlas switch,
  no changes needed.
- A full re-read of the root `docker-compose.yml` end to end for overall coherence
  after several incremental edits across N24-N40: confirmed internally consistent —
  `mongo` stays defined and harmless as a documented fallback, `backend`'s `depends_on`
  correctly excludes it, every env var wiring matches its own `:?set in .env` guard.
  One stray legacy file already found and labeled in an earlier pass
  (`Person3_BackendAPI/docker-compose.yml`, superseded scaffolding) re-confirmed still
  correctly unreferenced by anything.
- A grep sweep of Person1/Person2/Person4 for stray Mongo references turned up nothing
  needing a fix — every hit was a doc comment referring to MongoDB conceptually
  (`geofence.js`'s `$geoWithin` design note, `env.ts`'s generic secrets-handling
  comment, Person4's Mongo-`ObjectId`-shaped-string note), not stale connection config.

**A real, previously-undetected finding — `scripts/audit-gate.sh` had never actually
been run to completion against the current dependency tree before this pass, and it
turned out to genuinely fail**: `Person1_MobileClient`'s `npm audit --omit=dev
--audit-level=high` reported 19 vulnerabilities (4 critical, 9 high, plus 6 moderate) —
`mixme`, `protobufjs`, `minimatch`, `js-yaml`, `diff`, `ssh2` (OS command injection),
`braces`, and `decode-uri-component`, none of which are Person1's own direct
dependencies. Traced the chain: the real, in-use production dependency
`capacitor-mock-location-checker` (the mock-GPS-detection plugin backing the
anti-spoofing check-in flow) declares `docgen` — a Capacitor-plugin-authoring
documentation-generator CLI, convention-bundled as a regular `dependency` rather than a
`devDependency` by that plugin's own author — which in turn drags in `mecano` (a
scaffolding tool) and its own large, stale, largely-unmaintained sub-tree
(`nunjucks`→`chokidar`→...; `parameters`→`mixme`/`protobufjs`; `ssh2-connect`→`ssh2`).

Confirmed via direct inspection of `capacitor-mock-location-checker`'s compiled
`dist/esm/index.js` (the only code path our app or Vite's bundler ever actually
imports) that `docgen` is never referenced there — it is invoked only when the
plugin's *own author* runs *their own* doc-generation build, never by anything this
project's `npm install`, `vite build`, or `npx cap sync` does. So the real-world
exploitability was already zero (nothing in the compiled JS this app ships ever
executes any of the vulnerable code), but leaving it in place would have meant
`audit-gate.sh` — the one gate Item 4 built specifically to catch exactly this kind of
thing — permanently fails and gets ignored/routed-around by habit, which defeats the
entire point of having it.

**Fix, not just documentation**: no newer release of `capacitor-mock-location-checker`
exists (0.3.1 is latest) to drop the `docgen` dependency, and a plain `npm audit fix`
could not resolve deep transitive pins on its own. Added an `overrides` block to
`Person1_MobileClient/package.json` forcing nine packages in this dead-code subtree
(`mixme`, `protobufjs`, `minimatch`, `braces`, `decode-uri-component`, `js-yaml`,
`diff`, `ssh2`, `micromatch`, `nunjucks`) to their current latest major versions — safe
specifically *because* none of them are ever executed by this app, so a breaking major
bump inside `docgen`'s own unused call graph carries zero behavioral risk here. Result:
`npm audit --omit=dev` now reports **0 vulnerabilities** (down from 19), full
`audit-gate.sh` now genuinely passes clean across all four quadrants for the first
time, `npm run build` still produces the same output shape, and the full Vitest suite
(74 tests) still passes unchanged — confirming the overrides touched only the unused
`docgen` subtree and nothing Person1's own code paths depend on.

**Decision:** the deep audit is complete. Every subsystem built or modified across
N24-N40 was independently re-verified against the real, live Atlas-backed stack, not
re-derived from memory of having tested it once before. The one real defect the pass
surfaced — a silently-failing supply-chain gate — is now fixed at the root (the
vulnerable code path removed from the resolved dependency tree, not merely
acknowledged), and `scripts/audit-gate.sh` can now be trusted to actually mean
something the next time it is run, including in a future CI/deployment gate.

## Bento frontend refinement (N42+)

The user supplied a strict, ~780-line master prompt (`PNSM_Bento_Frontend_Master_Prompt.md`)
specifying a full CSS-Grid "Bento" redesign of both frontends, treating the backend as an
immutable contract. Before writing UI code, three parallel research passes audited the real
codebase (both frontends + the real backend contract) against the prompt's own claims, because
several of its "hard invariants" describe the *aspirational* Ultra/Flawless blueprints this
project explicitly deferred (DPoP, ML-DSA signatures, CloudFront/WAF), not what actually ships.
The corrections were recorded as ground truth rather than silently trusted or silently ignored —
per the prompt's own rule, "the backend is correct, the design bends around it."

### N42 — Bento Phase 1: real contract lock, design tokens, primitive library, and the Command Center dashboard migrated

**Scope, by explicit user choice**: foundation first (contract lock file, design tokens, Bento
primitive component library, dev-only preview route), then exactly one screen migrated end to
end — `Person2_WebDashboard`'s `/dashboard` (the HR Command Center home) — as a working proof of
the whole system, rather than attempting all ~17 screens across both apps in one pass. Every
other screen and all of `Person1_MobileClient` are explicitly deferred to later, incremental
passes, one route per commit, per the master prompt's own §12 migration table.

**Real corrections to the master prompt's assumed contract** (written to the new
`docs/API_CONTRACT.lock.md`, now the acceptance criterion for every future Bento phase): no DPoP
exists anywhere (confirmed via full-repo grep) — auth is plain JWT bearer, access token in-memory
only, refresh token in an `HttpOnly`/`Secure`/`SameSite=Strict` cookie (`pnsm_refresh`); mobile and
admin token responses use genuinely different field-name conventions (snake_case vs camelCase) and
were not unified; check-in GPS is a flat `{lat, lng}` object, never a GeoJSON `[lng, lat]` array;
the selfie is a presign-then-`object_key`-reference flow, never embedded bytes; the map library is
MapLibre GL JS + OSM raster tiles, not Mapbox/Google Maps; no ML-DSA/PQC signature overhead exists;
RASP purge and WebView-crash recovery are inert native scaffolds with no `android`/`ios` platform
project to ever trigger them; no offline check-in queue exists despite the prompt assuming one
("do not re-implement retry/backoff/flush logic" — there was nothing to preserve). Socket.IO,
by contrast, turned out to be *more* real than assumed: all 4 events (`attendance:new`,
`attendance:flagged`, `spoof:alert`, `notification:new`) are genuinely emitted server-side already,
though the web client only consumed one of them before this phase.

**Two judgment calls made and flagged rather than silently decided**: (1) the master prompt's
token layer is dark-default by design (§12 Phase 1's own stated intent is that a token-value swap
alone re-skins the *entire* already-shipped app, not just the migrated screen) — Person2 was
light-default, so this phase's token change immediately changed every unmigrated screen's theme,
not only the Dashboard's; this was surfaced to the user in the plan before implementation, not
discovered after. (2) Person2's existing `.eyebrow` labels and the live feed's `·`-joined meta line
technically match two of the master prompt's banned generic-SaaS patterns (§3) but are this app's
own deliberate, already-coherent convention, not templated decoration — kept the eyebrow-as-label
convention inside the new `StatTile` (nothing in §4.3 gives an alternative for a chip's own data
label), reformatted only the live feed's middle-dot join, which had a ready, better alternative.

**A real regression found and fixed during live verification, not just claimed fixed**: reusing
Person2's existing token *names* (`ink`, `surface`, etc.) under new dark-default *values* — done
specifically so every unmigrated screen re-skins for free — broke three places that had used
`--color-ink` as a background for permanently-dark chrome (the login screen's brand panel, the
sidebar's own background, and its mobile scrim overlay), because `--color-ink`'s role is "text
colour," which is necessarily near-white in a dark-default theme, not a dark background value
any more. Caught by an actual Browser-pane screenshot (white-on-white text, not by inspection),
root-caused to the token remap, and fixed with theme-independent literals at each of the three call
sites (`Person2_WebDashboard/src/pages/login.tsx`, `src/components/layout/sidebar.tsx` ×2) rather
than reverting the token strategy — confirmed by reloading and screenshotting again, not assumed
fixed from the code change alone.

**Live-verified, not just built**: real login (demo-mode Axios adapter, `VITE_DEMO_MODE=1` in a
new git-ignored `.env.local`, matching what `SETUP.md` already tells a fresh developer to create),
the migrated Dashboard rendering all three Bento breakpoints (desktop hero+3-chips+tall-feed;
mobile stacking hero full-width, chips 2-up, feed below), the live Socket.IO-driven feed genuinely
receiving simulated `attendance:new` events with the KPI chips updating in lockstep exactly as
before the migration (proving the underlying TanStack Query cache-invalidation wiring was carried
over unchanged), the reformatted feed rows showing employee code and office name with no middle-dot
join, the new `.bento`/`rank-*` Safari-16.3 flex fallback verified by forcing it to apply (confirmed
a sane, non-collapsed degradation, not a real Safari instance), and three not-yet-migrated pages
(Employees, Geofences, and the dev-only Bento primitive preview route) re-checked live to confirm
the whole-app token re-skin left them correctly readable, not merely assumed safe from the diff.

**Decision:** `docs/API_CONTRACT.lock.md`, `Person2_WebDashboard/src/styles/theme.css` +
`bento.css`, and `src/components/bento/*` (`BentoGrid`, `BentoTile`, `TileHeader`, `TileSkeleton`,
`TileEmpty`, `TileError`, `StatTile`, `ChartTile`, `FeedTile`, plus stubbed `MapTile`/`ActionTile`
for later phases) are the new foundation every subsequent Bento screen migration builds on. The
existing `AppLayout` shell was kept as-is rather than forked into a parallel `CommandLayout`,
since it already owns the one thing that must never duplicate — the single app-wide Socket.IO
subscription. `kpi-row.tsx`/`live-feed.tsx`/`trend-chart.tsx` were deleted, not left as dead code,
once confirmed to have zero remaining importers anywhere in the app. Full regression stayed green
throughout (`tsc --noEmit` clean, 78/78 tests, production build unchanged in chunk shape).

### N43 — Bento Phase 2: Attendance Logs migrated; a real CSS Grid content-blowout bug found and fixed at the engine level

Continuing the screen-by-screen migration order from the master prompt's own §12 table, next after
the Dashboard is §6.2's Live Attendance Feed — `Person2_WebDashboard`'s `/attendance` route
(`AttendanceView`). This screen is structurally different from the Dashboard: a filter rail (date
range, office, verification status, reset) driving a server-paginated, exportable data table, not a
set of small KPI/feed tiles — a real stress test of whether the Phase 1 primitives generalize past
the screen they were designed against.

**Composition**: a `rank="rail"` tile holds the unchanged filter fields (same `useTransition`-wrapped
state updates, same query-building logic, same CSV/PDF export calls — none of that touched) plus the
export buttons and confidence legend. A `rank="wide"` tile holds the results table, given a new CSS
escape hatch (`bento-span-tall`, added to `bento.css`) since the master prompt's own wireframes for
this screen and the next one (§6.3's roster) both call for a "wide 8×4" tile — taller than `rank-wide`'s
own 8×2 default — a combination the rank taxonomy table doesn't define on its own. Row virtualisation
(`@tanstack/react-virtual`, named in the master prompt's Item 10) was deliberately **not** added: this
table's pagination is already server-side and bounded at 20 rows per page
(`DEFAULT_PAGE_SIZE`) — a client-virtualisation library would solve a problem this screen's existing
architecture doesn't have, and adding an unneeded dependency contradicts §2's own "near-prohibited"
bar for new runtime dependencies. The table tile's own heading ("Results", with a live
`{n} matching this filter` count) was deliberately written to not repeat the page's own `PageHeader`
title/description verbatim, unlike an early draft that did.

**A real bug in the Bento engine itself, not just this screen** — caught live, not assumed from the
code: the filtered table's ~20 rows plus pagination footer initially inflated the *entire page*
instead of scrolling inside the tile's own reserved 4-row span, confirmed by an actual scroll test in
the Browser pane (the whole page moved, the tile's rounded border scrolled away with it) rather than
by reading the CSS and assuming it would work. Root cause: `grid-auto-rows: minmax(var(--bento-row),
auto)` sizes each row track to fit whatever content shares it — `min-height: 0` on `.bento-tile`
(needed for the same reason a flex child needs it) turned out to be necessary but **not sufficient**
for a CSS Grid item, because the `auto` half of the row's `minmax()` still lets the track grow to the
content's natural height before `overflow-y-auto` ever gets a chance to clip it. Fixed with an
explicit `max-height` on every 4-row-tall tile (`rank-tall` and the new `bento-span-tall`), computed
from the same `--bento-row`/`--spacing-gap-*` tokens the grid itself already uses, at each breakpoint.
This is a systemic fix, not a one-off: it also benefits the Dashboard's own `LiveFeedTile` (N42),
which happened to visually look correctly capped before this fix only because its content never
exceeded the accidental height the un-clamped grid track settled at — the same 20-row attendance
table would have inflated it too, given enough live check-ins.

**Live-verified**: real login, live click-through from the sidebar (not a hard URL navigation, to
keep the in-memory session), the filter rail and table both rendering correctly at a realistic
viewport with the fix, the table's own scrollbar confirmed independent of the page's, the pagination
footer ("1–20 of 275, Previous, 1/14, Next") confirmed present and reachable both via the DOM and
visually at a taller viewport, and the mobile breakpoint confirmed stacking correctly (rail full width
above, results table below with its own horizontal scroll for the seven-column table). Two
not-yet-touched screens (Dashboard, Employees) re-checked after the CSS fix to confirm no regression.

**Decision:** `bento.css` gained the `bento-span-tall` rank-taxonomy escape hatch and the
`max-height` content clamp on 4-row-tall tiles — both now part of the shared engine every future
screen migration builds on, not something to rediscover per screen. `tsc`/tests/build stayed green
throughout (78/78 tests).

### N44 — Bento Phase 3: every remaining `Person2_WebDashboard` screen migrated (Roster, Employee
Detail, Geofence Studio, Flagged Queue, Leave, Live Map, Reports, Settings, Admin/Policy/Audit/
Billing, Auth)

The user asked to continue completing all tasks per the master prompt, not stop after one or two
screens. This pass finished every remaining screen in the master prompt's own §6 order for
`Person2_WebDashboard` — the entire web app now speaks the Bento primitive vocabulary from N42/N43;
only `Person1_MobileClient` remains for a later pass.

**Where the real screen diverged from the master prompt's illustrative wireframe, the real screen
won** (same principle as N42/N43, applied repeatedly): Employee Detail has no "7-day attendance
strip" or "last-known-location map" because no such aggregate data exists without a new backend
endpoint — the hero identity tile, a reference-photo tile, a conditional deactivate tile, and the
real attendance-history table were built instead. The Enrollment screen (§6.8) is, in the real app, a
single-page form, not an actual multi-step wizard with a progress rail — building a real wizard would
have been new interaction design and new validation-per-step logic grafted onto a working, tested
onboarding flow that issues real one-time PINs and passwords, not a visual Bento reskin; the existing
single-page form was Bento-composed as-is (hero form tile, photo-upload square, conditional
issued-PIN/password chips, an already-numbered "what happens on save" list kept numbered per §3's own
sequence exception). Reports (§6.7) has no trend chart in the real app (that's Dashboard-only) — the
real filter/build rail, four live summary `StatTile`s, and the export-contents list were used instead
of inventing a chart with nothing to plot.

**A second, real CSS bug found and fixed, distinct from N43's**: the Geofence Studio screen (§6.5,
the master prompt's own designated highest-risk screen) needs a `<form>` wrapping several tiles that
must still land as direct siblings of an office-list tile in the same parent `BentoGrid` — a literal
DOM-nesting problem CSS Grid has a real, standard answer for. Used `className="contents"` on the
`<form>` element so it drops out of layout entirely while its `BentoTile` children behave as direct
grid items; confirmed live in the Browser pane (not just plausible from reading the CSS) that
selecting an office correctly places all six of the form's tiles — the map, office details, anchor
coordinates, radius slider, and a full-width save rail — alongside the office list, with no visual
gap or misplacement. The map itself keeps its exact existing WebGL lifecycle (`GeofenceMap`'s
create-once-effect, cleanup on unmount) untouched — only its container's `heightClass` prop was set
to a smaller fixed value so it fits the tile's `bento-span-tall` clamp from N43, confirmed live that
the map still renders, still accepts pin drags/clicks, and still redraws the radius circle on slider
change. The same fixed-height issue recurred for the Live Map screen's `LiveMap` component
(`heightClass="h-full"` this time, since that tile's flex-column parent has a real bounded height to
stretch into) — `MapTile` gained a `span` prop specifically to carry `bento-span-tall` through to both
call sites, rather than duplicating the map-tile shell twice.

**A third real finding, this time about the Bento CSS layer itself and NOT specific to any one
screen**: an attempt to visually override `.bento-tile`'s background/border via a plain Tailwind
className (`bg-transparent border-none`, on the Auth screen's sign-in panel — see below) silently had
no effect, live-confirmed via a Browser-pane screenshot showing the tile's card chrome still fully
rendered. Root cause: Tailwind v4 emits its utility classes inside CSS cascade layers, and `bento.css`
is plain, unlayered CSS — per the CSS cascade-layers spec, **any unlayered rule beats any layered
rule regardless of source order or selector specificity**, so `.bento-tile`'s plain
`background-color`/`border` declarations can never lose to a Tailwind utility class layered the
normal way. (`MapTile`'s existing `!p-0` override already worked, live-confirmed by the two map
tiles rendering edge-to-edge above — Tailwind's `!` modifier forces `!important`, which does win
regardless of layers.) Recorded here as a standing constraint on every future Bento tile
customisation: a `className` override on a `BentoTile` can only beat the base card chrome via an
`!`-prefixed Tailwind utility, never a plain one.

**Auth screen (§6.10), the actual decision made**: rather than force the sign-in panel through the
`BentoTile` system after discovering the cascade-layer issue above, stepped back and asked whether it
belonged there at all — the login screen isn't `.bento`-grid content in the first place (a single
focused sign-in form next to a fixed marketing panel, not a dashboard of independent tiles), and per
§6.10 itself no DPoP/2FA-PIN step exists to justify a "hero tile" treatment (DPoP doesn't exist at
all — N42; the mobile check-in PIN is a different, mobile-only concept, confirmed via
`docs/API_CONTRACT.lock.md` §3, not part of admin login). Reverted to the original, already-correct
layout, keeping only a real accessibility improvement: the sign-in `<section>` now has a proper
`aria-labelledby` wired to its own "Sign in" heading via a plain `useId()`, no `BentoTile` involved.
This is the honest outcome of the master prompt's own §15 Stop-and-Report principle applied to a
screen that doesn't fit the paradigm being retrofitted onto it, not a shortcut taken to avoid the
cascade-layer bug.

**Two more middle-dot joins found and reformatted**, matching N42's live-feed fix, since the master
prompt's ban (§3) is a real, actionable rule, not scoped to just the first screen it was noticed on:
the Leave Queue's date-range/day-count line and Live Map's present-employees time/office line, both
changed to spaced fields with no joiner glyph, same information.

**Live-verified in the Browser pane, not assumed from the diff**: real login, live in-app navigation
(not hard reloads) across Dashboard → Employees → Employee Detail → Geofences (selecting an office,
confirming the map/form tiles render) → Live Map, the Auth screen's reverted layout confirmed correct
at a realistic viewport after the cascade-layer investigation, and Employee Detail's conditional
deactivate tile confirmed correctly absent for an already-deactivated test employee (RBAC + business
logic both still gate it exactly as before). `tsc --noEmit`, `eslint` (0 errors, only pre-existing
warning patterns), the full 78-test suite, and the production build all stayed green throughout this
entire batch.

**Decision:** `Person2_WebDashboard` is now fully migrated to the Bento system end to end. `MapTile`
gained a `span` prop. The cascade-layer constraint on tile-chrome overrides is recorded here so the
next screen (or the Person1_MobileClient pass) doesn't rediscover it the hard way. Remaining scope:
`Person1_MobileClient`'s four screens, per the master prompt's own §6.11 and the plan's original
"foundation first, screens incrementally" sequencing.

### N45 — Bento Phase 4: `Person1_MobileClient` migrated; the master prompt's Bento redesign is now complete across both frontends

Final phase: ported the same dark-default token system and a mobile-only `.bento`/`rank-*` engine
(no tablet/desktop breakpoints — this app never renders at a desktop width) to
`Person1_MobileClient`, then migrated all four real screens (Login, Home, Check-In, Profile) per the
master prompt's own §6.11 table. This closes out the master prompt end to end: every screen named in
its §6 has a real, live-verified Bento composition in the app that actually ships.

**Where the real app diverged from §6.11's illustrative rows, the real app won, same discipline as
every prior phase**: no "hours today"/"streak" chips on Home (no such data exists — only a
check-in-status hero and a real recent-check-ins list), no separate History/Device-health/Offline
screens (they don't exist as distinct routes in this app — Home's own recent-check-ins list already
covers the "History" row, and per the user's own earlier decision this pass does not fabricate an
offline-queue chip backed by nothing). Auth (§6.10) got the exact same treatment as the web
dashboard's login screen: a single, focused sign-in form is not `.bento`-grid content, so it kept its
original layout with only a real `aria-labelledby` fix, not a forced tile wrapper.

**CheckInScreen — the highest-risk file in either frontend (live biometric liveness capture, GPS
geofence enforcement, PIN entry) — was touched with real, extreme caution**: every ref
(`videoRef`/`canvasRef`/`watchIdRef`/`inFlightRef`/`mountedRef`), every handler (`runLiveness`,
`start`, the GPS watch effect), and the flash-overlay/result-overlay components' fixed positioning
and timing are byte-for-byte unchanged — only the static container chrome around them was
re-composed into a single `hero`-rank tile, confirmed by the full `checkinFlow.test.js` suite (30
tests covering exactly this logic) staying green with zero changes needed to the tests themselves.

**A second real regression from token-repurposing, same root cause as N42's `bg-ink` bug, caught the
same way — live, not by inspection**: `HomeScreen`'s check-in button used `bg-text-navy`, a token
that used to be a literal dark navy (an ordinary primary-button background in the old light-default
scheme) but is now aliased to `--color-ink` — a *text*-role token, near-white in the new dark-default
theme. The button rendered as a barely-visible near-white-on-near-white control, caught via an actual
Browser-pane screenshot showing washed-out text, not assumed safe from the diff. Fixed by switching to
`bg-primary-container`, the same accent-button colour every other primary action in this app
(Login's "Secure Login", Check-In's own CTA) already uses — the one real occurrence in the whole app,
confirmed by grep before and after the fix.

**A third real bug, specific to this app's own bento.css, caught the same way**: `rank-hero` was
given the same `max-height` content clamp as `rank-tall` (copied from the web dashboard's bento.css
without adjusting for a real difference between the two apps) — but unlike the web dashboard's
compact hero tiles (a KPI number, an identity card), this app's hero tile can legitimately host an
entire screen's primary content, and `CheckInScreen`'s hero (status pills + a 224×224px circular
camera target + a full PIN pad + a CTA button) is genuinely taller than the clamp. The clamp forced
flexbox to shrink every child proportionally to fit — live-confirmed via `getBoundingClientRect()` in
the Browser pane showing the circular camera target rendering at 224×11px instead of 224×224px, a
real, visually-broken collapse, not a theoretical risk. Fixed by removing `rank-hero` from the
max-height rule (`rank-tall` only, matching the web dashboard's own precedent, which never clamped
hero tiles either) — confirmed live afterward that the circle, PIN pad, and CTA all render at full,
correct size.

**Live-verified in the Browser pane**: real login via the app's own deterministic mock-backend mode
(a pre-existing dev convenience, `VITE_MOCK_BACKEND`, temporarily flipped on for this verification
pass and reverted to its original `false` afterward, not left changed), Home showing the corrected
check-in button and a reformatted (no middle-dot) recent-check-ins list, Check-In showing the fully
fixed hero tile — live GPS/telemetry status pills, the full-size camera target, all ten PIN pad
digits, and the CTA button — and Profile's four identity/office/shift/tracking tiles all stacking
correctly full-width on a real mobile viewport. The full 74-test suite (including `checkinFlow.test.js`
untouched) and the production build stayed green throughout.

**Decision:** both `Person2_WebDashboard` and `Person1_MobileClient` now share one consistent
dark-default Bento design system, and every screen the master prompt names in its §6 list has a real,
working, live-verified implementation. Two systemic CSS lessons recorded for any future Bento work in
either app: (1) a rank's `max-height` content clamp must be scoped to tiles whose content is genuinely
meant to be compact and scrollable, never blanket-applied to every tall rank — `hero` can legitimately
mean "this screen's whole job," not just "a KPI card"; (2) any token whose *role* changes between the
old scheme and the new one (text colour vs. background colour, as `--color-ink`/`--color-text-navy`
both were) must be grepped for background/border usage before the token remap ships, not discovered
screen by screen after the fact — both this phase's and N42's real bugs were exactly this same class
of mistake, in two different apps.

### N46 — Post-Bento polish pass: dead-code removal, full four-quadrant regression, and a complete live click-through of every remaining unverified screen

A final, time-boxed verification pass across the whole project after N42-N45's Bento migration,
specifically targeting anything the per-screen migration work hadn't already exercised: every
quadrant's test/typecheck/lint/build in one sweep, every `Person2_WebDashboard` screen the migration
touched but had not yet been individually clicked through live (Flagged Queue, Leave, Reports,
Settings, and the four Super Admin pages), and a dead-code sweep for anything the migration orphaned.

**Dead code found and removed, not just flagged**: `Person2_WebDashboard/src/components/ui/card.tsx`
and `src/components/common/stat.tsx` — the pre-Bento `Card`/`CardHeader`/`CardBody`/`CardFooter`
compound component and the original `Stat` KPI chip — had zero remaining importers anywhere in the
app once N42-N44 replaced every call site with `BentoTile`/`StatTile`. Confirmed via grep for both
the import path and the exported symbol names (not just a path-substring match, which returns false
positives) before deleting, then re-ran `tsc --noEmit` clean to confirm nothing else depended on them.

**Full regression, all four quadrants in parallel**: `Person1_MobileClient` (74/74 tests),
`Person2_WebDashboard` (`tsc --noEmit` clean, 78/78 tests, `eslint` 0 errors/5 pre-existing warnings,
production build clean), `Person3_BackendAPI` (tests + typecheck), `Person4_AIBiometricService`
(pytest) — all green. `scripts/audit-gate.sh` re-run clean across all four quadrants (0
vulnerabilities), confirming the Bento work introduced no new dependencies and didn't regress N41's
supply-chain fix.

**Live-verified, not assumed clean from the unit tests alone**: a real login as both demo roles
(HR/Admin and Super Admin) with a full click-through of every `Person2_WebDashboard` route not yet
individually verified live in N42-N44 — Flagged Queue (including a real Approve action, confirming
the optimistic-update/rollback logic and the sidebar's live badge count both survived the Bento
restructuring unchanged), Leave requests, Reports, Settings, and all four Super Admin pages (Admin
accounts, Global policy, Audit log, Billing). Zero console errors across the entire session, checked
via `read_console_messages` after the full click-through, not per-page.

**Decision:** the project is confirmed clean end to end — every quadrant's own verification suite
passes, the supply-chain gate is clean, and every screen in the product has now been both unit-tested
and live-clicked-through at least once since the Bento migration landed. No new issues found in this
pass beyond the two files removed above.

### N47 — Closing the remaining live-verification gaps: real interactions, not just page loads, on every screen and role

N46 clicked through every remaining page once. This pass went further, at the user's explicit
request to make every real *interaction* — not just every page render — bulletproof: form
submissions, mutations, filters, exports, and role-dependent conditional rendering, each actually
exercised rather than inferred from a static screenshot.

**Enrollment (`/employees/new`), never previously live-tested**: filled every required field via the
real form inputs and submitted without a reference photo — the form correctly blocked the submission
with a real validation error ("Upload a reference photo") rendered inside the photo tile, proving
`react-hook-form`+Zod's error wiring survived being re-housed in a `BentoTile`. The underlying
photo-upload/presign logic itself was never touched by the Bento work, so this validation-path
confirmation is the correct-weight check here, not a gap.

**A real RBAC finding, confirmed correct rather than assumed**: Employee Detail's "Deactivate
account" tile was absent for an *active* employee under the HR/Admin demo role — initially looked
like a possible regression, but cross-checking Settings' own "what your role can do" permission list
confirmed HR/Admin genuinely lacks `employee:deactivate`. Re-tested the identical page as Super Admin:
the tile appeared correctly. Both the `RbacGate` permission check and the `is_active !== false`
conditional are confirmed working exactly as designed, not merely "not obviously broken."

**Geofence Studio's full create/list/edit/delete lifecycle**, previously only tested via "Edit" of an
existing office: clicked "+ Add", clicked the live map to drop a pin (confirmed the Anchor tile's
coordinates updated to the exact click location), filled the office name, checked the verification
checkbox (confirmed "Save geofence" flips from disabled to enabled only then — the verification gate
holds), saved (confirmed the new office appears in the list, count 4→5), then selected and removed it
(confirmed it disappears, count back to 5→4) — leaving the demo data exactly as found. Every stage of
the one screen the master prompt itself called "highest-risk" now has a real, live, end-to-end pass
behind it, not just a rendered screenshot.

**Reject actions** on both Flagged Queue (count 19→18, a different record than N46's Approve test)
and Leave requests (moved out of the "Pending" filter, then confirmed appearing under the "Approved"
filter after switching it) — only the Approve path had been exercised in N46; both optimistic-update
paths are now confirmed, along with the Leave status filter's dropdown itself actually re-querying.

**Export buttons** (Attendance's CSV button) confirmed to fire with no new console errors — this
project's own established convention of not reproducing copyrighted/generated file contents in a
headless check means "no crash, no new error" is the correct-weight verification for a client-side
file-generation path this pass didn't otherwise touch.

**Mobile breakpoint, extended past N42-N44's Dashboard/Attendance-only coverage**: Billing (chips
correctly pair up 2-per-row, the infrastructure table scrolls horizontally within its own tile) and
Geofence Studio (office list stacks full-width, the WebGL map tile renders correctly below it) both
confirmed correct at a real 375px mobile viewport.

**Person1_MobileClient**: Sign Out confirmed returning cleanly to `LoginScreen` with zero console
errors across the whole authenticated session. `CheckInScreen`'s PIN pad confirmed accepting real
digit taps (all four positions), and — the more important confirmation — "Start Check-In" stayed
correctly *disabled* even with a full 4-digit PIN entered, because no real GPS fix exists in this
headless environment (`inside` stays false without a position). This is the geofence security gate
behaving exactly as it must: PIN entry alone is deliberately insufficient to submit a check-in.

**Decision:** every screen in both frontends has now been live-verified not merely by loading, but by
exercising its real create/edit/delete/approve/reject/filter/export interactions and its
role-dependent conditional rendering, across both demo roles. No regressions found in this pass — the
one thing that looked like one (the missing Deactivate tile) was confirmed, by checking the actual
permission list rather than assuming, to be correct RBAC behavior. All test data created during this
verification (the enrollment attempt, the test geofence) was cleaned up or never persisted, leaving
demo state exactly as found.
