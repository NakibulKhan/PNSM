# Paste-Ready Messages to the Team

Copy these into the group chat as-is. Each is a complete, specific request with the exact
configuration needed — no back-and-forth required.

---

## → Person 3: CORS, and why it must allow credentials

> Hi — the admin console calls your API **directly from the browser** (no proxy), and it sends
> a cookie, so CORS needs two specific settings. Could you add this?

```js
const cors = require('cors');

const ALLOWED_ORIGINS = [
  'http://localhost:3000',            // our dev server
  'https://admin.pnsm.com',           // replace with the real CloudFront URL
];

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,                  // ← required: our refresh token is a cookie
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```

> **The gotcha:** `origin: '*'` is *invalid* when credentials are enabled — the browser rejects
> the response entirely. The origins have to be listed explicitly. Also please register the
> CORS middleware **before** your routes.
>
> Symptom if this is wrong: every request fails and the refresh cookie is never stored, so we
> get signed out on every page load.

### FastAPI version, if you go that way

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://admin.pnsm.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
```

---

## → Person 3: the dual-token flow, precisely

> Small but critical detail on `POST /auth/login`. Please return the **access token in the JSON
> body** and set the **refresh token as a cookie** on the same response:

```js
res.cookie('refresh_token', refreshToken, {
  httpOnly: true,        // JavaScript physically cannot read it
  secure: true,          // HTTPS only
  sameSite: 'strict',    // not sent on cross-site requests
  path: '/api/auth',     // only ever sent to the auth endpoints
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

return res.json({ data: { user, accessToken }, error: null });
```

> **Please do not put the refresh token in the JSON body.** We keep the access token in memory
> only (never localStorage) so an XSS bug can't steal a session — and that whole design falls
> apart if the long-lived token is readable by JavaScript.
>
> Two more things:
> - `POST /auth/refresh` must work with **no request body**, authenticating purely from the
>   cookie. We call it on every page load, because a memory-held token doesn't survive a
>   refresh. Return **401** if the cookie is missing/expired — we treat that as a normal
>   signed-out state, not an error.
> - If you rotate the refresh token on every use, please allow a few seconds' grace. We
>   serialise refreshes within a tab, but two open tabs can genuinely double-submit, and a
>   hard rotation would force a logout.

---

## → Person 3: Socket.IO handshake auth and CORS

> Socket.IO CORS is configured **separately** from Express CORS — it catches people out:

```js
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'https://admin.pnsm.com'],
    credentials: true,
    methods: ['GET', 'POST'],
  },
});
```

> We send the JWT in the handshake `auth` payload (not a query string, so it stays out of your
> access logs), supplied as a **callback** so reconnects always carry the current token:

```js
// ours
io(SOCKET_URL, { auth: (cb) => cb({ token: getAccessToken() }), autoConnect: false });
```
```js
// yours
io.use((socket, next) => {
  try {
    socket.data.user = jwt.verify(socket.handshake.auth.token, PUBLIC_KEY);
    next();
  } catch {
    next(new Error('invalid credentials'));
  }
});
```

> Please use exactly the string `invalid credentials` on failure — our client watches for it to
> refresh the token and reconnect, instead of retrying forever.

### Events we listen for

| Event | Payload | When |
| --- | --- | --- |
| `attendance:new` | full attendance log object | every check-in and check-out |
| `attendance:flagged` | full attendance log object | score below the threshold |
| `spoof:alert` | `{ _id, employee_name, detected_at, reason }` | mock location blocked |
| `notification:new` | `{ _id, message, created_at }` | any HR notification |

> **Include `_id` in every payload** — we deduplicate on it, so a reconnect that replays events
> can't double up the feed. And send the **whole** log object rather than just an id, so the feed
> renders instantly without a follow-up request.

---

## → Person 3: denormalised fields on attendance rows

> Every attendance row we render needs these alongside the raw document, or the table shows
> blank cells:

```json
{
  "_id": "…", "user_id": "…", "geofence_id": "…",
  "check_type": "check_in",
  "timestamp": "2026-07-25T03:02:11.000Z",
  "gps_location": { "type": "Point", "coordinates": [90.4152, 23.7925] },
  "face_match_score": 96.2,
  "selfie_url": "https://…",
  "status": "approved",

  "employee_name": "Rafiq Hasan",
  "employee_code": "PNSM-0142",
  "office_name": "Gulshan Office",
  "mock_location_detected": false
}
```

> A `$lookup` is one aggregation stage on your side; doing it on ours would be an N+1 request
> per visible row, which is unusable over mobile data.
>
> While you're in there — once `AttendanceLogs` grows, the filtered list query wants a compound
> index following **ESR** (equality, sort, range): `{ user_id: 1, timestamp: -1 }`, with the
> `$gte`/`$lte` date filters last. Otherwise it's a full collection scan.

---

## → Person 3: presigned S3 URLs (we can't mint them)

> Could you add `POST /uploads/presign`? Request `{ contentType, purpose: "reference_photo" }`,
> response `{ mode: "s3", uploadUrl, publicUrl, key }`.
>
> **Why it has to be you:** presigning requires an AWS secret key, and our app is a static
> bundle with no server — anything we ship is readable in DevTools. You already have the IAM
> credentials from Person 4 and the JWT middleware to authenticate the request.
>
> Please sign the **exact** `Content-Type` the client sends; we echo it verbatim on the PUT, and
> S3 rejects the signature if they differ. A 60-second expiry is plenty.
>
> No rush — our upload path detects a missing bucket and falls back to a placeholder, so
> onboarding already works end to end without it.

---

## → Person 4: S3 bucket CORS policy

> The photo upload goes **browser → S3 directly** with a presigned PUT. The presigned URL
> authorises the write, but the browser still needs the bucket to allow our origin. Could you
> add this under **S3 → bucket → Permissions → CORS**?

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://admin.pnsm.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> Without it the upload fails even though the signature is perfectly valid — and the browser's
> error message doesn't mention CORS, which makes it a nasty one to debug.

---

## → Person 4: CloudFront settings we depend on

> Two things on the distribution, please.

**1. Custom error responses — this one is not optional.**

| HTTP error code | Response page path | HTTP response code | Min TTL |
| --- | --- | --- | --- |
| 403 | `/index.html` | **200** | 0 |
| 404 | `/index.html` | **200** | 0 |

> Our whole app compiles to a single `index.html`. If someone bookmarks
> `/employees/onboarding` or just hits refresh, S3 looks for that exact object, doesn't find it,
> and returns an XML error before React Router ever loads. Mapping both codes to `/index.html`
> with a **200** hands path interpretation back to the client. Both codes matter — which one
> fires depends on whether the origin is a REST endpoint or a website endpoint.

**2. Response headers policy.** Static hosting has no Express, so `helmet` can't run — the edge
has to add the headers:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy:
  default-src 'self';
  img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.amazonaws.com;
  connect-src 'self' https://api.pnsm.com wss://api.pnsm.com https://*.amazonaws.com;
  worker-src 'self' blob:;
  style-src 'self' 'unsafe-inline';
  script-src 'self';
  frame-ancestors 'none';
```

> Three of those are load-bearing and easy to get wrong:
> - **`connect-src` must include the `wss://` scheme** — CSP treats the WebSocket upgrade as a
>   separate scheme. Omit it and the live feed silently never connects while every REST call
>   works fine. Genuinely confusing to debug.
> - **`worker-src 'self' blob:`** — image compression runs in a web worker created from a blob
>   URL. Without it, employee onboarding fails at the compression step, in production only.
> - **`img-src` needs `blob:`** for the local photo preview, plus the map tile host.

---

## → Person 4: biometric isolation (confirming our side)

> Just confirming we've built to the isolated-collection design: this console requests and
> renders only `has_face_embedding: boolean` plus non-sensitive metadata (`model_version`,
> `created_at`, `encrypted`).
>
> **We never ask for `vector_data` and it should never be returned to a browser.** We don't need
> it to render anything, and sending it would defeat the point of the CSFLE encryption.
>
> One ask: if you tune the 85% cosine-similarity threshold, tell us the number. It lives in a
> single constant on our side (`FACE_MATCH_THRESHOLD`), and the confidence bar, the KPI colours,
> the review-queue routing and the PDF exception marking all derive from it. If the two drift,
> HR sees check-ins marked "verified" that the backend actually flagged.

---

## → Person 1: coordinate order, spoofing flag, selfie URL

> Three things to agree before we merge — all cheap now, expensive later.

**1. Coordinate order.** MongoDB/GeoJSON stores `[longitude, latitude]`; most map libraries and
humans put latitude first. Dhaka is roughly `lng 90.4, lat 23.8`, so a flip never throws an
error — it silently puts everyone in the wrong place and every geofence check fails.
>
> Easiest fix: send **named fields**, which can't be mis-ordered:

```json
{ "lat": 23.7925, "lng": 90.4152 }
```

**2. Mock-location flag.** For FR-05, when you detect the mock provider
(`isFromMockProvider` on Android, `isSimulatedBySoftware` on iOS), please send a boolean with the
check-in. Person 3 stores it as `mock_location_detected`, and we render it as a red "Spoofed GPS"
badge in the attendance log and review queue, plus a list of attempts under Settings. If it's
never sent, that whole security feature is invisible to HR.

**3. Selfie URL (optional but valuable).** If you upload check-in selfies to S3, pass the URL
through as `selfie_url` on the log. It replaces the initials avatar in our live feed and review
queue — which turns reviewing a flagged check-in from guesswork into an actual visual decision.

> Also, we're both on Vite + React. Worth **copying** (not sharing a build) two files so we can't
> drift: `src/lib/geo.ts` (coordinate conversion + a flip detector) and `src/types/models.ts`
> (the document schema). Happy to send them over.

---

## → Everyone: our deployed URL

> The admin console is at **`https://admin.pnsm.com`** *(replace with the real URL)*.
>
> - **Person 3** — add it to your Express CORS allowlist **and** your Socket.IO CORS origins
>   (they're separate configs), both with `credentials: true`.
> - **Person 4** — add it to the S3 bucket CORS policy, and confirm the CloudFront custom error
>   responses are in place.
>
> Please do this **before** demo day rather than during it. Every one of these failures shows up
> as an unhelpful browser error that doesn't name the actual cause.
