# Merge Guide — integrating Quadrant II with Quadrants I, III and IV

Read this when the four quadrants come together. It states what this module expects from each
teammate, what it provides, and the order to switch things on.

---

## 0. What "merge" means here

The Web Command Center is a **self-contained Vite application**. It shares no build, bundler,
lockfile or runtime with anyone else's code. Merging is therefore not a code-merge problem —
it is a **configuration** problem:

1. drop this folder into the monorepo (or keep it as its own repo and deployment),
2. point two environment variables at the real services,
3. have Person 3 allow this origin **with credentials**, and Person 4 allow it on the S3 bucket.

Nothing in `src/` changes to go from demo to live. If someone is editing application code to
make integration work, check this guide first — something has been misunderstood.

### Suggested layout

```
PNSM/
  mobile/       Person 1  (Vite + React + CapacitorJS)
  backend/      Person 3  (Express 5 on Node 24, Dockerised)
  ai-service/   Person 4  (DeepFace / FastAPI, AWS ECS, S3, CloudFront)
  web-admin/    Person 2  ← this folder
  docs/         shared proposal, wireframes, report
```

Keep `web-admin/` with its own `package.json` and `node_modules`. **Do not hoist dependencies
into a root workspace** unless the whole team commits to a monorepo tool: `react-router-dom`
v7, React 18 and Recharts 2.x are pinned for compatibility reasons recorded in
`00-PLAN.md` §3.5, and a hoisted resolver may silently upgrade them.

Person 1 also builds a Vite + React app. **Resist the urge to share a node_modules or a
component library at merge time.** They target CapacitorJS WebViews on older WebKit; we target
desktop browsers. Sharing `src/lib/geo.ts` and `src/types/models.ts` by copying the files is
fine and worth doing — sharing a build is not.

---

## 1. Person 3 — Core API Infrastructure

Full specification: **`01-API-CONTRACT.md`**, implemented by `src/mocks/mock-api.ts` and
asserted by `src/tests/mock-api.test.ts`.

### The five things that will break integration if missed

1. **CORS with `credentials: true` and explicit origins.** `origin: '*'` is invalid with
   credentials; the browser drops the response. Symptom: every request fails and the refresh
   cookie is never stored.
2. **The refresh token must be an `HttpOnly; Secure; SameSite=Strict` cookie**, never in the
   JSON body. If it appears in the body, the XSS protection is gone.
3. **`POST /auth/refresh` must work with no body**, authenticating purely from the cookie. It
   is called on every page load.
4. **Denormalised fields** (`employee_name`, `employee_code`, `office_name`,
   `mock_location_detected`) on every attendance row, or the table renders blanks.
5. **The `{ data, error, meta }` envelope on every response.** A bare array makes every screen
   show its empty state.

### Switching this module onto the real API

```dotenv
VITE_DEMO_MODE=0
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```
Restart the dev server — `VITE_` values are inlined at build time, so a hot reload will not
pick them up.

### Integration order

Bring endpoints up one at a time; the mock covers whatever is not ready, so there is never a
broken state.

1. `POST /auth/login` + `/auth/refresh` + `GET /auth/me` → sign in and session persistence
2. `GET /offices`, `/geofences`, `/employees` → reference data
3. `GET /dashboard/kpis`, `/dashboard/trend`, `/attendance` → the dashboard fills
4. `POST /employees`, `POST|PATCH /geofences`, `POST /uploads/presign` → writes
5. Socket events → the connection indicator turns green

### Geospatial parity check

Person 3 validates with `$centerSphere`, whose radius is in radians. We draw the circle with
the identical conversion — `metres / 6378137.0` (`src/lib/circle.ts`). **Verify once at merge:**
create a 50 m geofence in the UI, then confirm a check-in 45 m away passes and one 60 m away
fails. If the visual and the enforced boundary disagree, the constant has drifted.

---

## 2. Person 4 — Biometrics, Cloud Security & DevOps

### S3 + CloudFront for reference photos

Person 4 provisions the bucket and gives Person 3 the IAM credentials — **not us**. There is no
server in this project, so we cannot hold an AWS key; anything shipped here is public. The
browser asks Express for a presigned URL, then PUTs directly to S3.

Person 4 must add a **bucket CORS policy** allowing this origin for `PUT` (exact JSON in
`04-MESSAGES-TO-TEAM.md`). Without it the upload fails with an error that does not mention
CORS.

Until the bucket exists, `/uploads/presign` returns `mode: "demo"` and onboarding still works
end to end with a placeholder image. Nothing is blocked.

### Biometric isolation — a contract we depend on

The blueprint moves embeddings out of the `Users` document into an isolated
`FaceEmbeddings` collection with CSFLE (AES-256-GCM, keys in AWS KMS). This console is built
to match: it requests and renders only `has_face_embedding: boolean` and non-sensitive
metadata (`model_version`, `created_at`, `encrypted`).

**The vector must never be returned to the browser.** We do not need it to render anything,
and shipping it would defeat the isolation the encryption exists to provide.

### Threshold ownership

The 85% cosine-similarity threshold appears in **one** place on our side —
`FACE_MATCH_THRESHOLD` in `src/lib/constants.ts`. Change it there and the confidence bar tick,
KPI colouring, review-queue routing and PDF exception marking all follow. If Person 4 tunes the
threshold, tell us the number; do not let the two drift.

### Deployment

We deploy to **S3 + CloudFront** (`aws/DEPLOYMENT.md`) or, if the team standardises on ECS, via
the multi-stage `Dockerfile` (node:24-slim builder → nginx:alpine runtime, final image under
50 MB). Use one or the other, not both.

**The CloudFront custom error responses are not optional.** Without them every deep link and
every page refresh returns raw XML. This is the single most likely deployment failure —
`02-BUG-BIBLE.md` §1.

Person 4 also owns the response-headers policy (CSP, HSTS, `X-Frame-Options`) since static
hosting has no Express to run `helmet`. Three CSP entries are load-bearing and easy to miss:
`connect-src` must include the `wss://` scheme or the live feed silently never connects;
`worker-src 'self' blob:` or image compression fails; `img-src` needs `blob:` and the tile host.

---

## 3. Person 1 — Mobile Edge Client

No direct code dependency; both are clients of Person 3. Three agreements matter.

**Coordinate order.** Send **named fields** (`{ "lat": …, "lng": … }`) rather than a tuple.
A flip never throws — it just puts everyone in the wrong place and fails every geofence check.
If a tuple is unavoidable, write the order down and have Person 3 validate it.

**Mock-location flag.** FR-05 requires blocking spoofed GPS. The mobile client evaluates
`isFromMockProvider` (Android) / `isSimulatedBySoftware` (iOS) and must report the result;
Person 3 stores it as `mock_location_detected`. We render it as a red "Spoofed GPS" badge in the
attendance log and review queue, and list attempts under Settings. If the field is never sent,
that entire security feature is invisible to HR.

**Selfie URL.** If check-in selfies go to S3, pass the URL through as `selfie_url` on the log.
It replaces the initials avatar in our feed and review queue, which turns manual review of a
flagged check-in from guesswork into an actual decision.

*Shared code worth copying (not importing):* `src/lib/geo.ts` and `src/types/models.ts`. Both
teams face the same coordinate hazard and the same document schema.

---

## 4. Merge-day checklist

Stop and fix at the first failure.

- [ ] `npm install` completes with no `ERESOLVE`
- [ ] `npm run verify` passes (typecheck + lint + tests + production build)
- [ ] Demo mode still works: `VITE_DEMO_MODE=1`, sign in, dashboard renders
- [ ] Switch to `VITE_DEMO_MODE=0`, restart, sign in against Express
- [ ] **Refresh the page while signed in — the session survives** (cookie + silent refresh)
- [ ] Leave the tab idle past the 15-minute access-token expiry, then click around: no logout
- [ ] Employees list shows real names, not blanks (denormalised fields present)
- [ ] Geofence pins land on the correct buildings; create one and inspect it in Atlas as `[lng, lat]`
- [ ] 50 m geofence: a 45 m check-in passes, a 60 m one fails (radian parity)
- [ ] Onboard an employee end to end; the photo appears in the S3 bucket
- [ ] Connection indicator reads **Live** (Socket.IO CORS + handshake auth)
- [ ] A mobile check-in appears in the feed within a second, **once**
- [ ] Attendance filtered to "today" includes an evening check-in (Dhaka boundary)
- [ ] CSV and PDF export open correctly, Bangla names intact in the CSV
- [ ] HR sees no Super Admin nav; Super Admin sees all screens
- [ ] **Deployed URL**: deep link + hard refresh works (CloudFront error responses)
- [ ] Deployed URL is in Express CORS, Socket.IO CORS and the S3 bucket CORS policy

---

## 5. If integration is going badly, fall back

Set `VITE_DEMO_MODE=1`, rebuild and redeploy. The console becomes fully functional on seeded
data with a simulated live feed and an amber banner stating plainly that it is demo data. The
presentation is never hostage to another service's uptime. See `07-SETUP-AND-RUNBOOK.md`.
