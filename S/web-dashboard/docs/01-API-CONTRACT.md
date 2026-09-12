# API Contract — what the Web Command Center consumes

**From:** Person 2 (Quadrant II) · **To:** Person 3 (Core API Infrastructure)

Implemented exactly as specified by `src/mocks/mock-api.ts` and asserted by
`src/tests/mock-api.test.ts` — develop against those tests and the frontend will work the
moment it is switched on.

The **browser calls you directly**. There is no server-side proxy in this architecture, so
CORS and credentialed requests are load-bearing. Base URL: `VITE_API_BASE_URL`
(default `http://localhost:5000/api`).

---

## Conventions

### Envelope — every response, including errors
```json
{ "data": <payload>, "error": null, "meta": { "page": 1, "pageSize": 20, "total": 240 } }
```
On failure:
```json
{ "data": null, "error": { "code": "MACHINE_CODE", "message": "Sentence shown to the user.", "details": {} } }
```
`error.message` is rendered verbatim in the UI — write it as a complete sentence a
non-technical HR user can act on.

### Status codes
`200` · `201` created · `400` malformed · `401` missing/expired token · `403` wrong role ·
`404` · `409` conflict (duplicate employee code) · `422` validation (field errors in
`error.details`) · `500`.

### Dates
ISO-8601 **UTC** in and out. The frontend does all Asia/Dhaka conversion. Never send a local
time without an offset.

### Coordinates — critical
GeoJSON **`[longitude, latitude]`**, matching the 2dsphere index. Dhaka is ~`lng 90.4`,
`lat 23.8`; `[23.79, 90.41]` is reversed. We reject reversed payloads before sending — please
reject them server-side too.

**On writes we send flat named fields** (`{ "lat": 23.7925, "lng": 90.4152 }`) precisely
because a named pair cannot be mis-ordered in transit. Convert to GeoJSON on your side.

---

## Authentication — dual token

### `POST /auth/login`
Request `{ email, password }`. Response body:
```json
{ "data": { "user": { "_id": "…", "name": "…", "email": "…", "role": "admin_hr", "role_name": "Admin", "reference_photo_url": null },
            "accessToken": "<15-minute JWT>" }, "error": null }
```

**The refresh token must NOT be in the body.** Set it as a cookie on the same response:
```
Set-Cookie: refresh_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=604800
```
If a refresh token ever appears in the JSON, the XSS protection is undone.

`role` is `super_admin` | `admin_hr` | `employee`. **Return 403 for `employee`** — this console
is admin-only.

### `POST /auth/refresh`
No body. Authenticate from the `refresh_token` cookie. Return `{ "data": { "accessToken": "…" } }`
and rotate the cookie. Return **401** when it is missing or expired — the client treats that as a
legitimate signed-out state.

This is called on **every page load** (the access token is memory-only and does not survive a
refresh), so it must be cheap.

> **Rotation warning.** We serialise refreshes, so you will never see two concurrent calls
> from one tab. If you invalidate the old refresh token on rotation, please allow a short
> grace window — a genuine double-submit from two tabs is otherwise a forced logout.

### `POST /auth/logout`
Clear the cookie and revoke the refresh token server-side. Return 200 even if already
signed out.

### `GET /auth/me`
Returns the `SessionUser` for the bearer token.

---

## CORS — required, with credentials

Every request carries `withCredentials: true` so the refresh cookie travels.

```js
app.use(cors({
  origin: ['http://localhost:3000', 'https://admin.pnsm.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
```
`origin: '*'` is **invalid** when credentials are enabled — the browser rejects it. List
origins explicitly.

---

## Endpoints

### Employees
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/employees?search=&officeId=&page=&pageSize=` | Search name, code, email, department. Include `office_name` and `has_face_embedding` per row. |
| POST | `/employees` | Body below → `{ employee, generated_pin }`. The PIN is returned **once**. |
| GET | `/employees/:id` | Plus `office_name`, `shift`, `recent_logs` (latest 25), `face_embedding_meta`. |
| PATCH | `/employees/:id` | Partial update |
| PATCH | `/employees/:id/photo` | `{ reference_photo_url }` → regenerate the embedding |
| DELETE | `/employees/:id` | **Soft** delete: `is_active: false`, keep history |

```json
{ "name": "Rafiq Hasan", "employee_code": "PNSM-0142", "email": "rafiq@company.com",
  "phone": "01712345678", "department": "Field Operations",
  "shift_start": "09:00", "shift_end": "18:00", "days_of_week": "Sun-Thu",
  "office_id": "<ObjectId>", "reference_photo_url": "https://cdn.pnsm.com/references/abc.jpg" }
```

The photo is **already in S3** before this call — you receive a URL, not a file. No multipart
handling needed. Pass the URL to Person 4 to generate the embedding.

**Biometric isolation.** The embedding vector belongs in its own `FaceEmbeddings` collection,
CSFLE-encrypted. **Never return `vector_data` to this console** — it is not needed to render
anything. Return only `has_face_embedding: boolean` and, optionally,
`face_embedding_meta: { model_version, created_at, encrypted }`.

### Uploads
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/uploads/presign` | `{ contentType, purpose: "reference_photo" }` → `{ mode: "s3", uploadUrl, publicUrl, key }` |

The browser cannot presign — there is no server here to hold the IAM key. You mint a
60-second URL scoped to one object key, authenticated with the same JWT middleware as every
other route. Sign the **exact** `Content-Type` the client sends; we echo it verbatim on the PUT.

### Offices & geofences
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/offices` · `/geofences` | Geofences include `office_name` |
| POST | `/geofences` | `{ office_name, address, lat, lng, radius_meters }` — creates office **and** geofence |
| PATCH | `/geofences/:id` | Any of the above |
| DELETE | `/geofences/:id` | |

`radius_meters` is metres. Your `$centerSphere` query needs radians:
`radiusInRadians = radius_meters / 6378137.0`. The circle we draw uses that same constant, so
the visual and the enforced boundary match exactly.

### Attendance
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/attendance?from=&to=&officeId=&employeeId=&status=&search=&page=&pageSize=` | `from`/`to` are UTC instants |
| GET | `/attendance/feed?limit=15` | Newest first, for the feed's first paint |
| GET | `/attendance/live-map` | Employees whose latest event today is a check-in |
| POST | `/attendance/:id/approve` · `/reject` | Returns the updated log |

Every row must carry these denormalised fields or the table renders blanks:
`employee_name`, `employee_code`, `office_name`, `mock_location_detected`.

> A `$lookup` is one aggregation stage on your side; doing it on ours would be an N+1 request
> per visible row.

**Query performance.** Once `AttendanceLogs` grows, the filtered list query needs a compound
index following ESR — equality first, then sort, then range:
`{ user_id: 1, timestamp: -1 }`, and for the office-scoped view
`{ geofence_id: 1, timestamp: -1 }`. Range filters (`$gte`/`$lte` on `timestamp`) go last.

### Dashboard, leave, Super Admin
| Method | Path | Response |
| --- | --- | --- |
| GET | `/dashboard/kpis` | `{ checkedInToday, onLeave, lateArrivals, avgFaceMatch, totalEmployees, flaggedToday }` |
| GET | `/dashboard/trend?days=7` | `[{ date: "2026-07-25", count: 187, label: "25/07" }]` |
| GET | `/leave?status=` · POST `/leave/:id/approve\|reject` | Include `employee_name` |
| GET | `/admins` · `/audit` · `/spoof-alerts` · `/billing` | |
| GET/PATCH | `/policy` | `{ face_match_threshold, default_radius_meters, late_arrival_cutoff, block_mock_location }` |

`checkedInToday` counts **distinct employees** for the Asia/Dhaka day — which begins at
**18:00Z the previous day**. A naive UTC-midnight boundary silently drops every evening shift.

Reports are generated client-side from `/attendance`, so no export endpoint is required.

---

## WebSocket (Socket.IO)

### Handshake auth
The JWT travels in the handshake `auth` payload — never a query string, so it stays out of
your access logs. We supply it as a **callback**, so reconnections always present the current
token:

```js
// ours
io(SOCKET_URL, { auth: (cb) => cb({ token: getAccessToken() }), autoConnect: false, withCredentials: true })
```
```js
// yours
io.use((socket, next) => {
  try { socket.data.user = jwt.verify(socket.handshake.auth.token, PUBLIC_KEY); next(); }
  catch { next(new Error('invalid credentials')); }
});
```
Use exactly `invalid credentials` on failure — the client watches for it to refresh and
reconnect rather than retrying forever.

Socket.IO CORS is configured **separately** from Express CORS:
```js
const io = new Server(httpServer, {
  cors: { origin: ['http://localhost:3000', 'https://admin.pnsm.com'], credentials: true },
});
```

### Events
| Event | Payload | When |
| --- | --- | --- |
| `attendance:new` | full `AttendanceLog` | every check-in and check-out |
| `attendance:flagged` | full `AttendanceLog` | score below threshold |
| `spoof:alert` | `{ _id, employee_name, detected_at, reason }` | mock location blocked |
| `notification:new` | `{ _id, message, created_at }` | any HR notification |

**Every payload must carry `_id`** — we deduplicate on it, so a reconnect replaying events
cannot double-render the feed. Send the complete object, not just an id, so the feed renders
without a follow-up fetch.

---

## Express 5 note

`path-to-regexp` v8 forbids unnamed wildcards. `app.get('/*')` throws
`TypeError: Missing parameter name at 1` and kills the process at boot. Use a named splat —
`app.get('/*splat')` — or `app.get('/(.*)')`.

## Priority order for us

1. **CORS + Socket.IO CORS** (see `04-MESSAGES-TO-TEAM.md`)
2. `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` — unblocks everything
3. `GET /employees`, `/offices`, `/geofences`
4. `GET /dashboard/kpis`, `/dashboard/trend`, `/attendance`
5. `POST /employees`, `POST|PATCH /geofences`, `POST /uploads/presign`
6. Socket events — last; the UI degrades gracefully without them

Until each arrives we run on the mock, so nothing is blocked on your side finishing.
