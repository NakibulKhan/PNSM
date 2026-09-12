# Person 3 — Blueprint Alignment Report

Refactor of the PNSM backend against `PNSM_4Person_Bulletproof_Plan.pdf` (Quadrant III).
Build verified: **zero TypeScript errors** other than the `socket.io` module-augmentation
line, which is purely a consequence of `node_modules` being absent in this sandbox.

---

## A. Changes made

### A1. Geospatial: corrected Earth radius (real precision bug)
The blueprint specifies `radiusInMeters / 6378137.0` for the `$centerSphere` conversion.
My code used the **mean** radius (6,371,000) for both that conversion *and* Haversine.
MongoDB's own docs agree with the blueprint: `$centerSphere` wants the **equatorial**
radius.

Now two clearly-named constants, because they are different numbers for different reasons:
- `EARTH_EQUATORIAL_RADIUS_METERS = 6_378_137` → `metersToRadians()` / `$centerSphere`
- `EARTH_MEAN_RADIUS_METERS = 6_371_000` → Haversine great-circle distance

Impact was small (~0.11%, about 11 cm on a 100 m radius) but it sits exactly on an
attendance decision boundary. Locked in with tests, including one asserting the radian
value is small enough to be a real geofence rather than the whole planet — the classic
`$centerSphere` failure where metres are passed straight through and every check-in passes.

### A2. New `geofenceService.ts` — the blueprint's spatial mathematics
- `isInsideGeofence()` — `$geoWithin` + `$centerSphere` over the 2dsphere index, exactly
  the query shape the blueprint specifies.
- `distanceToGeofenceCenter()` — `$geoNear` aggregation with `distanceField`, per the
  blueprint's analytics note. "How far away were they" is the most useful number on a
  rejected check-in, for both HR review and the employee's retry message.
- `findContainingGeofenceForOffice()` — handles offices with multiple zones (building +
  car park), per the proposal's Offices→Geofences one-to-many.
- `assertUsableCoordinates()` — range validation plus the Bangladesh flip-guard Person 2
  explicitly asked the backend to mirror.

### A3. JWT: RS256 support, token-kind separation, 7-day refresh
- `JWT_ALGORITHM` selects `RS256` (blueprint's production preference, PEM keypair) or
  `HS256` (default for dev, since RS256 needs keys to exist before boot).
- Refresh TTL 30d → **7d** per blueprint.
- **Added a `typ` claim on every token.** Under RS256 both tokens are signed with the
  *same* key, so without this claim a 7-day refresh token would verify perfectly as an
  access token — silently converting it into a permanent API key. The blueprint doesn't
  mention this; it's a hole that only opens *because* of the RS256 requirement. Tested
  in both directions.

### A4. HttpOnly refresh cookie — implemented additively, deliberately
Blueprint: refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie, access token
in the JSON body.

Implemented, **and** the refresh token is still returned in the body. That is not
redundancy, it is a compatibility requirement — see Conflict B1. `POST /auth/refresh`
now reads the cookie first and falls back to the body, and rotates *both* tokens.
Added `POST /auth/logout` to clear the cookie.

### A5. Express 5 upgrade
Reversed my earlier "stay on Express 4" recommendation — the blueprint mandates Express 5,
which outranks my prior judgement call. Audited for the `path-to-regexp` v8 breaking
change: **this app defines no unnamed wildcards**, so nothing to refactor. `asyncHandler`
is kept despite Express 5's automatic promise-rejection propagation, since it costs
nothing and keeps intent explicit. `@types/express` bumped to v5.

### A6. CORS — newly required, and easy to miss
**This is a consequence of the blueprint that isn't stated in it.** Person 1's client
changed from Flutter/React-Native to **Vite + React + Capacitor**. A Capacitor app runs
in a WebView — it is a browser. Its REST calls are now subject to CORS, where a native
HTTP client bypassed CORS entirely.

My architecture report previously concluded "REST needs no CORS at all." **That
conclusion is now wrong** and would have produced blocked mobile requests that look like
network failures. Added `cors` with an explicit allowlist (admin origins + Capacitor
origins: `capacitor://localhost`, `http://localhost`, `ionic://localhost`).
`credentials: true` is required for the refresh cookie, which forbids a wildcard origin.

### A7. Storage: provider-agnostic (R2 *or* S3)
Proposal says Cloudflare R2; blueprint says AWS S3. Both speak the S3 API, so this is now
one endpoint-configurable service (`STORAGE_PROVIDER=r2|s3`) instead of two code paths —
switching is an env change. Kept the R2 checksum workaround
(`requestChecksumCalculation: 'WHEN_REQUIRED'`), harmless against real S3, mandatory
against R2.

Also added server-side hardening the blueprint implies but doesn't spell out:
**content-type allowlist** and a **512 KB size cap**. Person 1 compresses to <200 KB
client-side, but a client-side limit is a UX optimisation, not a control — anyone can post
directly to the endpoint.

### A8. Biometric decoupling — `FaceEmbedding` collection + encryption seam
The blueprint calls the embedded-on-User design a "recognized vulnerability." Implemented:
- New `face_embeddings` collection, `user_id`-linked, unique per user.
- `vector_data` stored as **opaque ciphertext string**, `select: false`.
- `encryption: { algorithm, key_id }` recorded per document so keys can be rotated.
- `face_embedding` **removed** from the User schema and from `UserDTO`.
- New `embeddingCrypto.ts` seam: `EmbeddingCipher` interface + `setEmbeddingCipher()`.

Person 4 owns AES-256-GCM and KMS (Quadrant IV); I own the schema and persistence path.
The dev-time `PassthroughEmbeddingCipher` **is not encryption** and labels itself
`algorithm: 'none'` in every stored document, so an unencrypted vector can never be
mistaken for an encrypted one. **Recommended: add a production boot check that refuses to
start while `isEmbeddingEncryptionActive()` is false.**

---

## B. Conflicts requiring a team decision — NOT silently resolved

### B1. HttpOnly-only refresh would break both existing clients ⚠️
Blueprint: refresh token *only* in the cookie. But:
- **Person 2's `api-client.ts` (read-only) already destructures `refreshToken` from the
  login response body**, and their Next.js layer calls the backend **server-to-server**,
  where a browser cookie jar doesn't apply.
- **Capacitor WebViews are unreliable with cookies** across the native bridge, especially
  third-party/`SameSite=Strict` combinations.

Removing the body field would break Person 1 and Person 2 simultaneously. **Resolution
implemented:** issue both — cookie for browser contexts that can use it (real XSS
hardening), body for clients that structurally cannot. If the team wants strict
cookie-only, Person 2 must change `api-client.ts` first, and Person 1 must verify cookie
behaviour on a physical device.

### B2. Face-match "rejected" vs "flagged" — blueprint contradicts itself and Person 2
Blueprint Quadrant IV: *"If the score falls below the threshold, the anomaly is flagged,
the status is set to **rejected**."* That sentence is internally contradictory, and
`rejected` contradicts:
- **Proposal FR-07**: below 85% → *"flagged for HR review."*
- **Person 2's entire review queue UI**, which exists to approve/reject flagged check-ins.
- **ADR-5**, already locked.

**Keeping `flagged`.** Auto-rejecting a low score removes the human review step that HR
depends on and that FR-07 requires. `rejected` stays reserved for hard business-rule
failures (PIN, geofence, mock location, liveness). **Needs confirmation.**

### B3. Atlas M10+ vs M0 free tier 💰
Blueprint says "MongoDB Atlas (M10+ Tier)". M10 is roughly **$0.08/hr ≈ $57/month**. The
proposal explicitly budgets M0 free tier and documents the M10 upgrade as post-demo
(§2.7). **Recommendation: stay on M0 for the course project.** Someone needs to confirm
nobody is expected to pay for M10 during the semester.

### B4. AWS ECS/Fargate/CloudFront vs Render + Cloudflare R2 💰
Blueprint moves all infrastructure to AWS. The proposal (submitted, graded) specifies
Render/Koyeb + Cloudflare R2 free tiers, and the quotation prices that. AWS ECS Fargate
has no meaningful free tier. **This is Person 4's call**, but it changes the submitted
proposal's cost basis and deployment section. My storage layer now works with either, so
the backend is not the blocker.

### B5. Node v24-slim vs Alpine
Blueprint prefers `node:24-slim` over Alpine because musl libc breaks native C++ builds.
That reasoning is sound in general, but **we deliberately chose `bcryptjs` (pure JS) over
`bcrypt` (native) precisely to have zero native dependencies** — so Alpine is safe here
and produces a smaller image. **Kept Alpine.** Will switch if any native dep is ever added.

Related: the blueprint's Stage 2 = `nginx:alpine` applies to **Person 2's static frontend**,
not this API. An Express server is a running process; nginx cannot serve it. Our Dockerfile
correctly uses a Node runtime for Stage 2.

### B6. Still-open items from earlier ADRs (unchanged by the blueprint)
- **Work week Sun–Thu vs Mon–Fri** (ADR-3) — still unanswered.
- **Mobile auth contract** (ADR-6) — still the hard blocker on mobile routes. The
  blueprint's Capacitor + HttpOnly-cookie design makes this *more* urgent, not less.
- **PIN length** — proposal says 4–6 digits, implementation enforces exactly 4.
- **Proposal §4.1 lists 8 collections; the database now has 14** (13 + `FaceEmbedding`).
  Needs a v3 proposal revision or the submitted schema won't match delivery.

### B7. New Person 3 requirement implied by the blueprint
Person 1's Quadrant now includes a **background heartbeat firing every 15 seconds** per
device. That needs a backend endpoint nobody has specified, and at 15s intervals it is by
far the highest-volume route in the system — it needs its own rate-limit budget, a
lightweight payload, and probably a capped/TTL collection rather than unbounded inserts.
**Not built.** Flagging so it gets specified rather than discovered in week 7.

---

## C. Person 3 status

**Done:** MongoDB Atlas + 2dsphere schema (14 models), geofence validation service
(`$geoWithin`/`$centerSphere`/`$geoNear`), custom dual-token JWT with RS256 support and
token-kind separation, HttpOnly cookie rotation, RBAC matrix, CORS for Capacitor + admin,
provider-agnostic storage service with size/type limits, biometric decoupling + encryption
seam, Socket.IO foundation, Express 5, error/security middleware, Docker, `/health`,
15 test files.

**Not done (Phase 2):** check-in pipeline wiring the above together, employee/geofence/
leave/dashboard/Super-Admin routes, mobile routes (blocked on B6), heartbeat endpoint
(blocked on B7).

**Still cannot verify in this sandbox:** no network egress (`npm install` blocked), no
Docker binary. Run `npm install && npm run build && npm test` on your machine — note that
`npm install` will now pull **Express 5**, so watch for any peer-dependency warnings from
`express-rate-limit` or `helmet` and send them to me if they appear.
