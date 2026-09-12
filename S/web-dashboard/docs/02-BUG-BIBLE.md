# Bug Bible

Every failure mode this codebase is built to survive. Format: **symptom → cause → fix →
verify**. Marked ⚠️ **SILENT** where nothing errors, and 🌐 **PROD-ONLY** where local
development looks perfect.

---

## 1. 🌐 PROD-ONLY — React Router deep links 404 on CloudFront

**Symptom.** Internal navigation is flawless. Then someone bookmarks
`https://admin.pnsm.com/employees/onboarding`, or just presses **refresh** on any screen other
than the root, and gets a raw XML error page.

**Cause.** Vite compiles everything into a single `/index.html`. There is no
`employees/onboarding/index.html` object in the bucket. S3 is an object store, not a router:
it looks for that exact key, fails, and CloudFront returns 403 or 404. React Router never
boots, so it never gets to interpret the path.

**Fix.** CloudFront → **Error pages** → create two custom error responses:

| HTTP error code | Response page path | HTTP response code | Min TTL |
| --- | --- | --- | --- |
| 403 | `/index.html` | **200** | 0 |
| 404 | `/index.html` | **200** | 0 |

Map **both**: a REST origin with `ListBucket` denied (the secure setup) returns 403, a website
endpoint returns 404. `ErrorCachingMinTTL: 0` matters or the edge caches the broken mapping.

nginx equivalent, already in `nginx.conf`: `try_files $uri $uri/ /index.html;`

**Verify.** `src/e2e/smoke.spec.ts` → "a deep link survives a hard reload". Run against the
deployed URL, not just locally — Vite's dev server has this fallback built in, which is
exactly why the bug only appears in production.

---

## 2. 🌐 PROD-ONLY — Tailwind v4 collapses the layout on Safari 16.3

**Symptom.** The dashboard renders correctly everywhere, then an executive opens it on an
older iPad and every grid child stacks into overlapping containers.

**Cause.** Tailwind v4's output leans on `@property`, `color-mix()` and cascade layers.
WebKit shipped `@property` and `color-mix()` in **Safari 16.4**. On 16.3 and earlier those
declarations are dropped at parse time, grid track definitions that depend on the generated
custom properties fail to resolve, and children fall back to `display: block`.

**Fix.** Downgrading to v3 is not viable (it conflicts with the Vite 6 plugin pipeline).
Instead, feature queries in `src/index.css` supply flexbox layouts to exactly the agents that
cannot parse the modern syntax:

```css
@supports not (color: color-mix(in oklab, red 50%, blue)) {
  .layout-grid, .kpi-grid, .split-grid { display: flex !important; flex-wrap: wrap !important; }
  .kpi-grid > * { flex: 1 1 calc(50% - 0.75rem); min-width: 190px; }
}
```

Layout containers therefore carry both a Tailwind grid class **and** a semantic hook
(`kpi-grid`, `split-grid`). Removing the hook silently removes the fallback.

**Verify.** `npm run e2e` includes a WebKit project locally. Confirm on a real 16.3 device or
BrowserStack before the demo.

---

## 3. ⚠️ SILENT — the coordinate flip `[lng, lat]` vs `[lat, lng]`

**The most dangerous bug in the project.** Nothing throws. The pin lands in the Indian Ocean,
or every check-in fails geofence validation and it looks like a backend fault.

**Cause.** GeoJSON and MongoDB use `[longitude, latitude]`. Human convention and several
libraries put latitude first.

**What helps here.** MapLibre GL uses `LngLat` — longitude first, the **same** order as
GeoJSON. That removes the conversion at the map boundary entirely (Leaflet, being
latitude-first, was historically the main source of this bug). The risk now concentrates at
the API and form boundaries.

**Fix.** One conversion layer (`src/lib/geo.ts`) plus an active detector. For Bangladesh a
reversed tuple puts a value in 20.5–26.7 first and 88–92.7 second — impossible in correct
data — so `geoJSONPointSchema` rejects it before it can be stored. Writes send **flat named
`lat`/`lng` fields**, which cannot be mis-ordered in transit. The editor warns when a pin
falls outside Bangladesh, and shows the GeoJSON form beside the human-readable one.

**Verify.** `src/tests/geo.test.ts`, `src/tests/circle.test.ts`.

---

## 4. ⚠️ SILENT — Dhaka is UTC+6, so "today" starts at 18:00Z yesterday

**Symptom.** Evening check-ins vanish from today's dashboard. Totals are short by a few hours'
worth of records and look plausible enough that nobody notices in testing.

**Cause.** `new Date().setHours(0,0,0,0)` gives the runtime's local midnight, not Dhaka's.

**Fix.** All boundaries from `src/lib/tz.ts`:
`dhakaDayStartUtc('2026-07-25')` → `2026-07-24T18:00:00.000Z`.
Formatting is pinned to timezone **and** locale, which also removes a class of rendering
inconsistencies between machines.

**Verify.** `src/tests/tz.test.ts`, including the 23:30-Dhaka case.

---

## 5. ⚠️ SILENT — parallel 401s fire parallel refreshes and force a logout

**Symptom.** Intermittent, usually right after the access token expires: the dashboard dumps
the administrator to the login screen even though the session is valid.

**Cause.** The dashboard opens four requests at once. They all 401 in the same tick. A naive
interceptor issues one refresh per failure. Because Person 3 **rotates** refresh tokens, the
second refresh presents a token the first already invalidated — so it fails, and the failure
handler signs the user out.

**Fix.** Serialise. The first 401 performs the refresh; every other 401 parks in a queue and
replays once the single refresh resolves (`src/api/http.ts`). Also `_retried` guards against
an infinite loop when the replay itself 401s, and `/auth/login` is excluded because a failed
login is a wrong password, not an expired session.

**Verify.** `src/tests/auth-refresh.test.ts` → "issues exactly ONE refresh for several
simultaneous 401s".

---

## 6. Signed out on every page refresh

**Symptom.** A valid session is lost whenever the tab reloads or a deep link opens fresh.

**Cause.** The access token lives in memory by design (OWASP: anything in Web Storage is
XSS-exfiltrable). Memory does not survive a reload.

**Fix — not "persist the token".** `bootstrapSession()` calls `/auth/refresh` on boot; the
browser attaches the HttpOnly cookie automatically and Express returns a fresh access token.
`RequireAuth` renders a spinner while `status === 'loading'` — redirecting during that window
would sign out every returning user.

**Requires:** `withCredentials: true` on the client **and** `credentials: true` plus an
explicit origin on the server. With a wildcard origin the browser silently drops the cookie.

---

## 7. CORS: `blocked by CORS policy` / cookie never sent

**Cause.** The browser talks straight to Express — there is no proxy in this architecture, so
CORS is real and unavoidable.

**Three requirements, all necessary:**
1. `credentials: true` on the Express CORS middleware
2. Explicit origins — `origin: '*'` is **invalid** with credentials
3. Socket.IO CORS configured **separately** from Express CORS

Paste-ready config: `04-MESSAGES-TO-TEAM.md`.

---

## 8. S3 presigned PUT returns 403

**Causes, in order of likelihood:**

1. **Bucket CORS missing.** The presigned URL authorises the write; the bucket must still
   allow the origin. The browser error does not mention CORS.
2. **`Content-Type` mismatch.** The header must match what was signed, byte for byte.
3. **An extra `Authorization` header.** Our S3 upload deliberately uses `fetch` with
   `credentials: 'omit'` rather than the shared Axios instance — sending our JWT to Amazon
   would leak it to a third party *and* invalidate the S3 signature.

`src/api/uploads.ts` handles (2) and (3); (1) is Person 4's bucket policy.

---

## 9. Uploads time out on a slow connection

**Cause.** A modern phone photo is 10–15 MB.

**Fix.** Compress below 200 KB in a **web worker** before anything crosses the network, then
PUT straight to S3 so the image never transits the API container.

**EXIF gotcha.** Phone selfies carry an orientation tag; read it with
`getExifOrientation()` and pass it through or compressed photos come out rotated 90°.

**Quality floor.** Do not squeeze purely for size — Person 4's pipeline needs facial detail.
Long edge capped at 1080 px, quality held at 0.8.

**CSP gotcha.** The worker is created from a blob URL, so the policy needs
`worker-src 'self' blob:`. Without it, onboarding fails at the compression step in
production only.

---

## 10. StrictMode connects the socket twice

**Symptom.** Every check-in appears twice in development. Production looks fine, which makes
it easy to dismiss.

**Cause.** StrictMode mounts, unmounts and remounts every component. `socket.io-client`
connects the instant it is constructed, so a socket built inside a component leaves an
orphan.

**Fix.** Module singleton, `autoConnect: false`, connect in an effect and **disconnect in the
cleanup**, plus dedupe by `_id` before events reach the cache. Do **not** disable StrictMode —
it is reporting a real missing cleanup.

**Verify.** `src/tests/socket-lifecycle.test.tsx`.

---

## 11. WebGL contexts exhausted; the map renders blank

**Symptom.** The geofence editor works, then after visiting it several times it renders an
empty box with no error.

**Cause.** Browsers cap live WebGL contexts (~16 in Chrome). Each MapLibre instance holds
one. StrictMode doubles the rate. Without `map.remove()` in the effect cleanup, they leak.

**Fix.** Both map components call `marker.remove()` and `map.remove()` on unmount, and the
map instance is created **once** — position and radius are synced through separate effects
that mutate sources in place. Recreating the map on every prop change would destroy and
rebuild a GPU context 60 times a second while the radius slider is dragged.

---

## 12. Mapbox GL JS throws without an access token

**Symptom.** `An API access token is required to use Mapbox GL JS.`

**Cause.** Mapbox GL JS v2+ validates a token for telemetry and billing even when pointed at
a third-party style.

**Fix here.** The project uses **MapLibre GL JS**, the open fork with an identical API and no
token requirement, so the map works for every teammate with no key. To move to Mapbox,
change only `src/components/map/gl.ts`: install `mapbox-gl`, swap the import, set
`mapboxgl.accessToken = MAPBOX_TOKEN`. Nothing else imports the engine.

---

## 13. `VITE_` variables: leaked secrets, or `undefined` at runtime

Two failure directions, one rule.

- Prefixed `VITE_` → **inlined into the bundle and public**. There is no server runtime here,
  so **no secret can live in this project at all**. AWS keys, the Mongo URI and the JWT secret
  belong to Express and the ECS task definition.
- Not prefixed → not exposed to client code at all; reading it yields `undefined`, which
  usually shows up as a request to `undefined/api/...`.

Values are frozen at **build** time. Changing one on a deployed site requires a rebuild, not
a restart — which is why the Dockerfile takes them as `ARG`s in the builder stage.

---

## 14. Express 5 crashes at boot: `TypeError: Missing parameter name at 1`

**Cause.** `path-to-regexp` v8 (bundled with Express 5) forbids unnamed wildcards to prevent
ReDoS. `app.get('/*')` throws immediately.

**Fix.** Named splat: `app.get('/*splat')`, or `app.get('/(.*)')`. Person 3's issue, listed
here because it presents as "the API is completely down" during integration.

---

## 15. Free-tier backend cold starts look like a broken app

**Symptom.** The first request after idle hangs 30–60 s, then succeeds.

**Fix.** A 70-second Axios timeout and a typed `BACKEND_TIMEOUT` / `NETWORK_UNREACHABLE`
error whose message reads as *waiting*, not *failing*.

**Demo tactic.** Hit the backend two minutes before presenting.

---

## 16. Everything shows its empty state

**Cause.** The API returned a bare array instead of `{ data: [...] }`.

**Fix.** The envelope is mandatory on every response. `src/tests/mock-api.test.ts` is the
reference implementation.

---

## 17. TanStack Table rejects `meta: { align: 'right' }`

`ColumnMeta` is an intentionally empty interface for apps to extend. Module augmentation
lives in `src/types/tanstack-table.d.ts`.

---

## 18. Excel mangles Bangla names in the CSV
Prefix the blob with a UTF-8 BOM (`'\uFEFF'`). Already done in `lib/export-csv.ts`.

## 19. Bangla names come out blank in the PDF
jsPDF's built-in fonts are Latin-1 only. `registerBanglaFont(base64Ttf)` accepts a Noto Sans
Bengali TTF; `hasBanglaText()` lets the UI warn rather than silently emit empty cells.

## 20. Optimistic updates leave the UI lying after a failed write
The flagged-review mutation snapshots the list in `onMutate`, restores it in `onError` and
invalidates in `onSettled`, so a failed decision puts the row **back** in the queue instead of
pretending the review happened.

## 21. `localStorage` query cache fails in private mode
IndexedDB via `idb-keyval`, every operation in a try/catch. Losing the cache is acceptable;
crashing the dashboard is not. Only successful queries are persisted.
