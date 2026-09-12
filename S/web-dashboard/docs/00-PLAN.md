# Execution Plan — Quadrant II: Web Command Center

> The durable record of *why* the code is shaped the way it is. Keep it with the
> code through the merge. If a decision here is reversed later, edit this file
> rather than leaving the code and the plan disagreeing.

## 1. Scope: what Person 2 owns

| Requirement | Where it lives |
| --- | --- |
| FR-01 Employee onboarding & reference-photo capture | `/employees/new`, `/employees/:id` |
| FR-02 Geofence definition — anchor pin + radius slider | `/geofences` |
| FR-05 Mock-location anomalies surfaced to HR | attendance badges, `/settings` |
| FR-07 The 85% cosine threshold made legible and actionable | `ConfidenceBar`, `/flagged` |
| FR-09 Real-time HR telemetry (consumer side) | live feed, socket hook |
| FR-10 Attendance dashboard and CSV/PDF reporting | `/dashboard`, `/attendance`, `/reports` |
| FR-12 RBAC across the interface | `lib/rbac.ts`, route guards |
| Flagged check-in review | `/flagged` |
| Leave approvals | `/leave` |
| Live workforce map | `/live-map` |
| Super Admin: accounts, policy, audit, billing | `/admins`, `/policy`, `/audit`, `/billing` |

## 2. Stack, per the enterprise blueprint

React 18 · **Vite 6** · TypeScript (strict) · **React Router v7** (`createBrowserRouter`) ·
**Tailwind CSS v4** (Oxide/`@theme`) · **Axios** with interceptors · TanStack Query v5 ·
TanStack Table v8 · react-hook-form + Zod · **MapLibre GL JS** (WebGL) · Socket.IO client ·
Vitest + Playwright · deployed to **AWS S3 + CloudFront**

Vite replaces the deprecated CRA bundler: native ES modules in development give
microsecond HMR, and Rollup handles the production build. Tailwind v4 runs through its
first-party Vite plugin, so the Rust-based Oxide compiler and Lightning CSS execute
in-process with no `tailwind.config.js` and no separate PostCSS pass.

## 3. Architecture decisions

### 3.1 Dual-token auth: access in memory, refresh in an HttpOnly cookie

This is the single most consequential decision in the module.

- **Access token, 15 minutes, in a module closure** (`src/api/token-store.ts`). Never in
  `localStorage` or `sessionStorage`. Web Storage is readable by any script on the page,
  so a single XSS payload exfiltrates a session; a token in the JS heap gives that payload
  nothing to read and cannot outlive the tab.
- **Refresh token, 7 days, in an `HttpOnly; Secure; SameSite=Strict` cookie** set by
  Express. JavaScript is physically barred from reading it.

The accepted cost is that **a page refresh destroys the access token**. That is not worked
around by persisting it — it is why `bootstrapSession()` performs a silent refresh on boot,
trading the cookie for a fresh token before the first screen renders.

### 3.2 The Axios interceptor layer is the integration seam

`src/api/http.ts` injects the bearer token on every request and, on a 401, suspends the
failed request, refreshes, and replays it. The user sees nothing.

The non-obvious part is **serialisation**. The dashboard opens with four parallel requests;
when the token expires they all 401 in the same tick. One refresh per failure would be
fatal because Person 3 rotates refresh tokens — the second refresh presents a token the
first already invalidated. So the first 401 performs the refresh and every subsequent one
parks in a queue and replays afterwards. `src/tests/auth-refresh.test.ts` pins this.

### 3.3 Authorisation is the API's job; the router only keeps the UI honest

OWASP A01 is explicit that client-side routing guards are not access control.
`RequireAuth` / `RequirePermission` compose as parent routes so a new screen inherits the
right protection by placement — but if every guard were deleted, a user could reach any URL
and would simply receive 403s from Express for everything they are not entitled to. **That**
is the security boundary.

### 3.4 Demo mode is a first-class feature

`VITE_DEMO_MODE=1` swaps the **Axios adapter** for an in-process mock
(`src/mocks/demo-adapter.ts` → `src/mocks/mock-api.ts`) with deterministic seeded data and a
simulated socket emitting a check-in every nine seconds.

An adapter sits *below* the interceptors, so the auth header injection, the 401 refresh
path and the error normalisation all execute exactly as in production. Three purposes:
build before the backend exists; act as an executable contract test for Person 3; and
guarantee the demo runs when Render is cold or the venue blocks WebSockets. A visible amber
banner keeps it honest.

### 3.5 Deviations from the blueprint, and why

| Blueprint said | Built instead | Reason |
| --- | --- | --- |
| Mapbox GL JS (or Google Maps) | **MapLibre GL JS** | Mapbox GL JS v2+ throws without a paid access token even against a third-party style, which would break the map for any teammate without a key and put the demo at the mercy of rate limits. MapLibre is the open fork with an identical API and no token. Migration is three lines, confined to `src/components/map/gl.ts`. |
| Redux **or** Context for global state | **Context for auth + TanStack Query for server state** | Redux would be ceremony around data that is really a server cache. Query gives caching, retries, invalidation and background refetch for free; Context holds only the signed-in identity, which is genuinely global. Socket payloads are merged into the Query cache so pushed and fetched data cannot disagree. |
| — | Hand-written UI primitives | No component-library CLI step, so `npm install && npm run dev` works first time with no codegen and no peer-dependency negotiation. |
| — | System font stack | Downloading a web font at build time makes a build fail on an unreliable connection. Personality comes from the sans/mono pairing. |

### 3.6 Design direction

An **instrument panel**, not a marketing dashboard. Every measured value — coordinates,
radii in metres, match percentages, timestamps — is set in tabular monospace (`.tnum`), and
colour states a fact rather than decorating a container.

The signature element is the **confidence bar with a tick at the 85% threshold**. A score in
isolation means nothing to a reviewer; what matters is its relationship to the
auto-approval rule. The bar answers "did this pass, and by how much" at a glance and appears
identically in the live feed, the attendance table, the review queue and the live map, so the
reading is learned once.

Palette: ink `#0F1B2D` (rail), canvas `#F5F7FA`, accent `#1E5FA8`, with a fixed signal set —
verified `#0E7C5A`, flagged `#B4690E`, rejected `#B3261E`. One animation exists in the whole
product: new feed rows arrive with a brief accent rule, so motion always means "this just
happened". `prefers-reduced-motion` is respected.

## 4. The failures this codebase is built around

Each fails **silently** or **only in production**, which is what makes them dangerous.

| # | Failure | Defence |
| --- | --- | --- |
| 1 | **CloudFront 404 on deep links** — refreshing `/employees/onboarding` returns raw XML, because no such S3 object exists | Custom Error Responses map 403 **and** 404 → `/index.html` with a **200**. `aws/DEPLOYMENT.md`, plus an e2e reload test |
| 2 | **Safari 16.3 grid collapse** — Tailwind v4 emits `@property` and `color-mix()`, unsupported before Safari 16.4; grid tracks fail to resolve and the dashboard stacks into overlapping containers | `@supports not (color: color-mix(…))` feature queries supplying flexbox fallbacks, in `src/index.css` |
| 3 | **Coordinate flip** `[lng, lat]` vs `[lat, lng]` — never throws; puts a Dhaka office in the ocean and makes every check-in fail validation | Single conversion layer (`lib/geo.ts`), a flip detector that rejects the reversed pattern, flat `lat`/`lng` on writes, regression tests |
| 4 | **Dhaka is UTC+6** — a local day starts 18:00Z the previous day; naive boundaries silently drop every evening shift | All boundaries via `lib/tz.ts`, pinned by tests |
| 5 | **Parallel 401s trigger parallel refreshes** — rotation invalidates the first token and logs the user out | Serialised refresh with a replay queue |
| 6 | **StrictMode double-connects the socket** — every check-in appears twice | Module singleton, `autoConnect: false`, effect cleanup, dedupe by `_id` |

Full catalogue with fixes and verification: **`02-BUG-BIBLE.md`**.

## 5. Definition of done

- [x] Every requirement in §1 implemented and reachable from the nav
- [x] Wireframes Fig 3.4 and Fig 3.5 reproduced field for field
- [x] Runs standalone with zero external services (`VITE_DEMO_MODE=1`)
- [x] Switches to the live API by changing one environment variable
- [x] Dual-token auth with silent boot refresh and serialised 401 replay
- [x] WebGL geofence editor whose circle matches `$centerSphere` exactly
- [x] CloudFront deep-link fix documented, configured and e2e-tested
- [x] Safari 16.3 fallbacks in the stylesheet
- [x] Loading, empty, error and offline states on every data surface
- [x] `npm run verify` (typecheck + lint + test + build) as the pre-push gate
- [x] `npm audit --audit-level=high` gating the pipeline (OWASP A03)
