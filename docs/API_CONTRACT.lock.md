# PNSM API Contract — locked

This file is the acceptance criterion for the Bento frontend refactor (see
`PNSM_Bento_Frontend_Master_Prompt.md` §1.2). It records the REAL backend contract as read directly
from `Person3_BackendAPI` source, not the master prompt's aspirational claims. A Bento change is
correct only if network traffic before and after is identical for the same user action. Do not edit
this file to match a design brief's assumptions — edit the design instead, or stop and report.

## 1. Auth mechanism

Plain JWT bearer tokens (`jsonwebtoken`, dual-token: access 15m / refresh 7d, algorithm `HS256` dev /
`RS256` optional). **No DPoP, no proof-of-possession, no ML-DSA/PQC signing exists anywhere in this
codebase** — confirmed via full-repo grep, zero real hits. Any frontend work must not invent DPoP
headers, nonce challenges, or IndexedDB WebCrypto key material.

- `Authorization: Bearer <token>` on every protected request — the only auth header.
- A `typ: 'access'|'refresh'` claim prevents refresh-token reuse as an access token. This is the only
  proof-of-possession-adjacent mechanism; it is a claim check, not a cryptographic key binding.
- Socket.IO auth: same plain-JWT verify, read from `socket.handshake.auth.token` (not query string).
  On failure the server sends the exact literal string `'invalid credentials'` — clients pattern-match
  on this to trigger a refresh + reconnect.

### Token response shape — differs per app, do not unify

**Mobile** (`POST /api/mobile/auth/login`, `/refresh`): snake_case body —
`{ access_token, refresh_token, user }`.

**Admin** (`POST /api/auth/login`, `/refresh`): camelCase body —
`{ accessToken, refreshToken, user }`.

Both also set a cookie: name `pnsm_refresh`, `httpOnly: true`, `secure: <isProduction>`,
`sameSite: 'strict'`, `path: '/api/auth'`, `maxAge: 7 days`. Issued in both cookie and body
simultaneously because Capacitor WebViews are unreliable with cookies alone.

### Frontend token handling (already correct in both apps — preserve as-is)

- Access token: in-memory only. Never `localStorage`/`sessionStorage`/`Preferences`/IndexedDB.
  Person2: `src/api/token-store.ts` (module closure variable). Person1: `src/lib/http.js`.
- Refresh token: never read/written by JS — lives entirely in the `pnsm_refresh` HttpOnly cookie.
- 401 handling: single-flight refresh with a waiter queue so concurrent 401s don't fire parallel
  `/refresh` calls. Person2: `src/api/http.ts`. Person1: `src/lib/http.js` (also special-cases
  `reason: 'pin_mismatch'` and similar business-rule 401s to pass through untouched, not treated as
  "must refresh").

## 2. Full route inventory

Mounting (`src/routes/index.ts`): `/api/mobile` → mobile router; `/api` → admin router;
`/health` → unprefixed health check.

### `/api/mobile/*` (every route except `/auth/*` requires `requireAuth('mobile')`)

| Base | Endpoints |
|---|---|
| `/auth` | `POST /login`, `POST /refresh`, `POST /logout` |
| *(root)* | `GET /me` |
| `/attendance` | `POST /checkin`, `POST /anomaly` |
| `/heartbeat` | `POST /` |
| `/uploads` | `POST /presign` |

### `/api/*` (every sub-router calls `requireAuth('admin')`)

| Base | Endpoints |
|---|---|
| `/auth` | `POST /login`, `POST /refresh`, `POST /logout`, `GET /me` |
| `/employees` | `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `PATCH /:id/photo`, `DELETE /:id` |
| `/offices` | `GET /` |
| `/geofences` | `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` |
| `/uploads` | `POST /presign` |
| `/attendance` | `GET /`, `GET /feed`, `GET /live-map`, `GET /:id/selfie-url`, `POST /:id/approve`, `POST /:id/reject` |
| `/leave` | `GET /`, `POST /:id/approve`, `POST /:id/reject` |
| `/dashboard` | `GET /kpis`, `GET /trend` |
| *(root)* | `GET /admins`, `GET /audit`, `GET /spoof-alerts`, `GET /admins/incidents`, `GET /billing`, `GET /policy`, `PATCH /policy` |

`GET /health` — unprefixed, unauthenticated.

## 3. Check-in contract (mobile)

`mobileCheckinSchema` (Zod, `src/validation/mobileSchemas.ts`) — exact field set, do not rename or add:

```
check_type:       'check_in' | 'check_out'
timestamp:        ISO-8601 string, with offset
captured_at:       ISO-8601 string, with offset
gps:               { lat: number (-90..90), lng: number (-180..180) }   // FLAT object, never [lng,lat]
geofence_id:       string, min 1
pin:               string, exactly 4 digits (/^\d{4}$/)
liveness_frames:   array, max 4, each { color: 'red'|'green'|'blue'|'white', image: { kind: 'base64', value } }
object_key:        string, min 1   // the selfie — a reference to an already-presigned-uploaded object,
                                    // NOT raw image bytes embedded in this payload
device:            { platform: 'android'|'ios'|'web', os_version, app_version,
                     is_mock_location: bool, is_emulator: bool, is_rooted: bool }
request_id:        string, min 10, optional
```

**GPS is always `{lat, lng}`, never a GeoJSON `[longitude, latitude]` array on this wire.** The selfie
upload is a two-step flow: `POST /uploads/presign` first, then reference the resulting `object_key` in
the check-in body — the image bytes themselves never appear in the check-in request.

Response (wrapped `mobileOk`): `{ attendance_log_id, status, face_match_score, reason, server_timestamp }`.
`status ∈ {'approved', 'flagged', 'rejected'}`. **A `'rejected'` decision returns HTTP 200** with the
reason in the body, not a 4xx — do not branch UI logic on status code for this endpoint, branch on the
`status` field.

Selfie compression ceiling: `MAX_SELFIE_BYTES = 200 * 1024` (200KB), enforced client-side
(`Person1_MobileClient/src/lib/compression.js`) before upload — never raise capture resolution/quality
for visual polish.

## 4. Geofence contract

`createGeofenceSchema`/`updateGeofenceSchema` (`src/validation/geofenceSchemas.ts`): flat fields —
`office_name`, `address`, `lat`, `lng`, `radius_meters` (positive number).

**Radius is transmitted and stored in metres, as a plain number, field name `radius_meters`.** Server
conversion (`src/utils/geo.ts`):

```js
EARTH_EQUATORIAL_RADIUS_METERS = 6_378_137   // WGS-84 equatorial — deliberately NOT the mean radius
metersToRadians(m) = m / EARTH_EQUATORIAL_RADIUS_METERS
```

used in `$geoWithin: { $centerSphere: [[lng, lat], radiusInRadians] }`. Never pre-convert to radians
or kilometres client-side; send the raw metre integer.

## 5. Dashboard data contract (used by this phase's Command Center screen)

`GET /api/dashboard/kpis` (no query params) →
```
{ checkedInToday, onLeave, lateArrivals, avgFaceMatch, totalEmployees, flaggedToday }
```
All numbers; `avgFaceMatch` is a rounded percentage integer (0-100).

`GET /api/dashboard/trend?days=N` →
```
[{ date: 'YYYY-MM-DD', count: number, label: 'DD/MM' }, ...]
```
Oldest-first, Dhaka-timezone calendar days.

`GET /api/attendance/feed?limit=N` → `AttendanceLog[]`, newest-first. Each log carries at least
`_id`, `employee_name`, `employee_code`, `office_name`, `check_type`, `timestamp`, `face_match_score`,
`selfie_url`.

## 6. Socket.IO — 4 real events, all actively emitted server-side

`SOCKET_EVENTS` (`src/constants/index.ts`):

| Event | Emitted when | Payload |
|---|---|---|
| `attendance:new` | Every successful check-in (`approved` or `flagged`) | Full `AttendanceLog` document, always includes `_id` |
| `attendance:flagged` | Additionally, when `status === 'flagged'` | Same payload as above |
| `spoof:alert` | AI service returns `MOCK_LOCATION`/`EMULATOR_DETECTED` during check-in, or `POST /attendance/anomaly` | `{ _id, employee_name, detected_at, reason }` |
| `notification:new` | Alongside a flagged check-in, and on leave-request events | `{ _id, message, created_at }` |

Person2's client (`src/lib/socket.ts` + `src/hooks/use-socket.ts`) currently subscribes only to
`attendance:new`. The other three are real, already-locked contract — safe to subscribe to in future
frontend work with zero backend risk, since nothing server-side needs to change to do so.

Auth: JWT via the handshake `auth` callback (re-evaluated every reconnect, not query string).
`withCredentials: true`. Transports `['websocket', 'polling']`.

## 7. Security headers

```js
helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
  frameguard: { action: 'deny' },
})
```
Only `default-src 'self'` is explicitly configured — helmet fills its own defaults for every other
unspecified directive (`font-src`, `img-src`, `connect-src`, `script-src`, etc.), since `useDefaults`
is not disabled. `X-Frame-Options: DENY` is set. There is no bespoke `connect-src`/`img-src` allowlist
today for a frontend to rely on. No real CloudFront/WAF exists — treat the CSP-consciousness rules in
the master prompt (self-host fonts, no third-party script/icon/font origins, no iframes, no runtime
`eval` CSS-in-JS) as good practice to follow regardless, since they cost nothing and the policy could
tighten later.

## 8. Biometric decision contract

`status ∈ {'approved', 'flagged', 'rejected'}` (`ATTENDANCE_STATUSES`, `src/constants/index.ts`).
Real thresholds (Person4_AIBiometricService, the actual decision-maker — Person3's own
`Policy.face_match_threshold` is display-only, not authoritative):

```
PNSM_APPROVE_THRESHOLD = 85.0
PNSM_FLAG_THRESHOLD    = 60.0
```
`score ≥ 85` → approved. `60 ≤ score < 85` → flagged. `score < 60` → rejected. The client never
re-computes, re-thresholds, or re-labels this — it is server-authoritative, display-only on read.

## 9. Map provider

**MapLibre GL JS** (open-source Mapbox GL JS fork) + OpenStreetMap raster tiles, no API key required
(`Person2_WebDashboard/src/components/map/gl.ts`, `.env.example`'s `VITE_MAP_TILE_URL`). Mapbox itself
is only a commented-out future option (`VITE_MAPBOX_TOKEN`), not active. No Google Maps anywhere.

## 10. RASP / device-compromise signal

No dedicated "device compromised" endpoint exists. `POST /api/mobile/attendance/anomaly` is scoped
specifically to mock-location reporting (hardcodes `reason: 'mock_location_detected'` server-side
regardless of what the client submits). Root/emulator/mock flags travel as part of the check-in
payload's own `device` object, not a separate channel. RASP purge-and-terminate and WebView-crash
recovery are pure native scaffolds (`Person1_MobileClient/native/*.java|*.swift`, all headed
"STATUS: SCAFFOLD — NOT WIRED UP") — no `android/`/`ios/` Capacitor platform project exists in this
repo at all, so nothing can trigger these states today.

## 11. Explicitly not implemented (do not design frontend features assuming these exist)

DPoP / RFC 9449 proof-of-possession. ML-DSA / post-quantum-signed JWTs. Real MongoDB Queryable
Encryption (AES-256-GCM field envelopes are the real substitute — `src/crypto/fieldEnvelope.ts`).
Real AWS CloudFront/WAF/GuardDuty (a local nginx TLS-proxy in `infra/` is the closest real analog).
An offline check-in queue on the mobile client (no IndexedDB/localStorage-backed queue, no
retry-on-reconnect logic exists in `Person1_MobileClient` today).
