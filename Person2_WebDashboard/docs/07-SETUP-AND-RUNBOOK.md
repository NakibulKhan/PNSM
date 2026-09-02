# Setup & Runbook

---

## 1. First run (Windows)

**Prerequisites:** Node.js **20.11 or newer** (24 LTS matches the deployment image). Check with
`node -v`.

```powershell
cd E:\CSE482L\PROJECT\Person_2

npm install
copy .env.example .env.local

npm run dev
```

Open **http://localhost:3000** → redirected to `/login`. Click **HR / Admin**, then **Sign in**.
Demo mode accepts any password of six characters or more.

### If `npm install` fails

- **`ERESOLVE` peer conflict** — do not reach for `--force`. Versions are pinned deliberately
  (`00-PLAN.md` §3.5). Delete `node_modules` and `package-lock.json`, confirm your Node version,
  reinstall.
- **Slow or proxied link** — `npm install --prefer-offline` after one successful run.

---

## 2. Environment

Everything is documented inline in `.env.example`. Only one matters on day one:

```dotenv
VITE_DEMO_MODE=1     # standalone: mock backend + simulated live feed
```

### Switching to the live API

```dotenv
VITE_DEMO_MODE=0
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

**Restart the dev server after any change.** Vite inlines `VITE_` values at build time; a hot
reload will not pick them up. A deployed site needs a rebuild, not a restart.

### The `VITE_` rule
Prefixed → in the bundle and **public**. There is no server runtime in this project, so **no
secret belongs here at all**. AWS keys, the Mongo URI and the JWT secret live in Person 3's
Express container and Person 4's ECS task definition.

### Optional: skip CORS while developing
```dotenv
VITE_USE_DEV_PROXY=1
VITE_API_ORIGIN=http://localhost:5000
```
Vite proxies `/api` and rewrites the Origin. Production is always cross-origin, so Person 3's
CORS config still has to be right — this only removes local friction.

---

## 3. Daily commands

| Command | Does | When |
| --- | --- | --- |
| `npm run dev` | Dev server on :3000 | while building |
| `npm run typecheck` | `tsc --noEmit` | before every commit |
| `npm run test` | Vitest | before every commit |
| `npm run build` | Typecheck + Rollup production build | before every push |
| `npm run preview` | Serve `dist/` locally | to test the real bundle |
| `npm run verify` | typecheck + lint + test + build | **the pre-push gate** |
| `npm run e2e` | Playwright against a preview build | before the demo |
| `npm run audit:ci` | `npm audit --audit-level=high` | weekly, and before release |

Playwright needs its browsers once: `npx playwright install chromium webkit`.

**Always test `npm run preview`, not just `npm run dev`, before deploying.** The dev server has
an SPA fallback built in and hides the deep-link bug that appears on CloudFront.

---

## 4. Where things live

```
src/
  api/          Axios instance + interceptors, token store, typed client, S3 uploads
  auth/         session lifecycle, auth context, route guards
  router/       createBrowserRouter route table
  layouts/      root providers/boundary, authenticated shell
  pages/        one file per route, default-exported and lazily imported
  components/
    ui/         primitives (button, card, confidence bar…)
    layout/     sidebar, topbar, connection status
    dashboard/  KPI row, live feed, trend, queues, admin views
    map/        MapLibre engine boundary + geofence and live maps
    forms/      onboarding, geofence editor, photo upload
    tables/     data table, column defs, list views
    providers/  TanStack Query + IndexedDB persistence
  lib/          geo, circle geometry, tz, rbac, exports, compression, socket
  config/       env
  mocks/        Axios demo adapter + in-process mock backend + seed
  schemas/      Zod validation
  types/        models mirroring Person 3's schema
  tests/  e2e/  Vitest + Playwright
aws/            CloudFront + S3 deployment notes and error-response config
docs/           this documentation set
```

**Rules worth keeping.**
Coordinates convert **only** through `lib/geo.ts`. Dates format **only** through `lib/tz.ts`.
Environment reads **only** through `config/env.ts`. The map engine is imported **only** in
`components/map/gl.ts`. The access token is read **only** through `api/token-store.ts`.

---

## 5. Deployment

Full detail in **`aws/DEPLOYMENT.md`**. The short version:

```bash
npm run build

aws s3 sync dist/ s3://pnsm-admin-web --delete \
  --cache-control "public,max-age=31536000,immutable" --exclude "index.html"

aws s3 cp dist/index.html s3://pnsm-admin-web/index.html \
  --cache-control "no-cache,no-store,must-revalidate"

aws cloudfront create-invalidation --distribution-id EXXXX --paths "/index.html"
```

Then, **once, on the distribution** — and this is the step that breaks deployments when skipped:

| HTTP error code | Response page path | HTTP response code | Min TTL |
| --- | --- | --- | --- |
| 403 | `/index.html` | **200** | 0 |
| 404 | `/index.html` | **200** | 0 |

Deploying with `VITE_DEMO_MODE=1` gives a fully working public demo with no backend at all —
useful for sharing progress with the group and the instructor.

---

## 6. Demo day runbook

### T-minus 1 day
- [ ] `npm run verify` green
- [ ] `npm run e2e` green
- [ ] Deployed build tested in **both** demo and live modes
- [ ] **Deep link + hard refresh tested on the deployed URL**
- [ ] Deployed URL confirmed in Express CORS, Socket.IO CORS, S3 CORS
- [ ] Screenshots of every screen as a last-resort fallback

### T-minus 20 minutes
- [ ] Open the backend URL to wake the instance (30–60 s)
- [ ] Sign in and load every screen once, warming caches
- [ ] Open a **second** browser window with the dashboard already loaded
- [ ] Confirm the connection indicator reads **Live**
- [ ] Decide now: if the API is not answering, switch to demo mode and redeploy

### Smoke test — 90 seconds, immediately before presenting
1. Sign in as HR → dashboard renders, four KPI cards populated
2. **Press refresh** → still signed in (proves the silent-refresh path)
3. Live feed shows rows; wait for one to arrive and animate
4. `/employees` → search a name → filters
5. `/geofences` → select an office → WebGL map draws, pin and circle visible
6. `/attendance` → export CSV → downloads
7. `/flagged` → approve one → row leaves, toast confirms
8. Sign out → sign in as Super Admin → the Super Admin nav group appears

### Suggested narrative (~4 minutes)
1. **Sign in as HR.** One line on why the console is admin-only.
2. **Dashboard.** The four KPIs, then wait for a live check-in to land. Explain the confidence
   bar and its tick at 85% — the whole verification story in one glyph.
3. **Onboard an employee.** Show compression (15 MB → under 200 KB) and the presigned
   direct-to-S3 upload. Reveal the generated 2FA PIN.
4. **Geofences.** Drag the pin, use the *Construction site 500 m* preset, point out the
   coordinates shown in both human and GeoJSON form, and the confirmation gate. Mention that the
   circle uses the same radian conversion the database enforces.
5. **Flagged queue.** Approve one below-threshold check-in; explain the human-in-the-loop design.
6. **Reports.** Export the PDF; below-threshold scores are marked red for payroll.
7. **Sign in as Super Admin.** The nav itself changes — and note that the API re-checks
   independently, so this is not just hidden UI.

### If something breaks mid-demo
- **Feed stops updating** → the indicator already says so. "The socket dropped; records are still
  being written — here they are." Navigate to `/attendance`.
- **A screen fails** → the error boundary offers a reload. Use it once, then move on.
- **Backend dies entirely** → switch to the demo-mode deployment. Say so plainly; the banner
  already does.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| XML error on refresh / deep link (deployed) | CloudFront error responses missing | `02-BUG-BIBLE.md` §1 |
| Dashboard stacks into overlapping boxes on old iPad | Safari < 16.4 | §2 |
| Signed out on every page refresh | `withCredentials` or CORS `credentials` missing | §6, §7 |
| Logged out after ~15 minutes | Refresh not serialised, or rotation with no grace | §5 |
| Login works, all other calls 401 | CORS origin wildcard with credentials | §7 |
| Upload fails with an opaque error | S3 bucket CORS | §8 |
| Live feed never connects, REST fine | CSP missing `wss:` in `connect-src` | §9 |
| Onboarding fails at compression (prod only) | CSP missing `worker-src blob:` | §9 |
| Every check-in appears twice | Socket cleanup missing | §10 |
| Map blank after several visits | WebGL contexts leaked | §11 |
| Pin in the ocean | Coordinates reversed | §3 |
| Evening check-ins missing from "today" | Dhaka day boundary | §4 |
| Express dies at boot, `Missing parameter name` | Express 5 unnamed wildcard | §14 |
| Everything shows its empty state | API returning a bare array | §16 |
