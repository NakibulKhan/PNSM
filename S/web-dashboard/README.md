# PNSM Web Command Center — Quadrant II (Person 2)

**PNSM Workforce Attendance & Management System** · HR and Super Admin console
North South University · CSE482L Internet and Web Technology · Summer 2026 · Group 8

---

## What this is

The command portal for HR personnel and Super Admins. Employees check in from Person 1's
Capacitor mobile client with a selfie, GPS and a 2FA PIN; Person 3's Express 5 API validates the
geofence with MongoDB `$geoWithin`; Person 4's inference engine scores the face match. **This**
application is where the workforce is onboarded, spatial boundaries are configured, verified
check-ins stream in live, exceptions are reviewed and payroll reports are exported.

It runs **completely standalone**. Set `VITE_DEMO_MODE=1` and every screen works against an
in-process mock backend with seeded data and a simulated live feed — no API, no database, no AWS,
no teammate required.

## Quick start (Windows)

```powershell
cd E:\CSE482L\PROJECT\Person_2
npm install
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000 → click **HR / Admin** → **Sign in**. Any six-character password works
in demo mode.

Full setup, including switching to the live API: **`docs/07-SETUP-AND-RUNBOOK.md`**

## Documentation map

Everything needed to continue, hand over or merge this work lives in `docs/`:

| File | What it is |
| --- | --- |
| `docs/00-PLAN.md` | Execution plan and architecture decisions. **Read first.** |
| `docs/01-API-CONTRACT.md` | Every endpoint and socket event consumed. Send to Person 3. |
| `docs/02-BUG-BIBLE.md` | 21 failure modes with cause, fix and verification. |
| `docs/03-MERGE-GUIDE.md` | Integration with Quadrants I, III and IV. |
| `docs/04-MESSAGES-TO-TEAM.md` | Paste-ready CORS, cookie, S3 and CloudFront requests. |
| `docs/05-SCREEN-SPECS.md` | Screen-by-screen spec with RBAC and state coverage. |
| `docs/06-RISK-REGISTER.md` | What can go wrong before the demo, and the built mitigation. |
| `docs/07-SETUP-AND-RUNBOOK.md` | Setup, deployment, demo-day runbook, troubleshooting. |
| `docs/08-CONTRIBUTION-LOG.md` | Coursework deliverable and submission checklist. |
| `aws/DEPLOYMENT.md` | S3 + CloudFront, including the deep-link fix. |

## Stack

React 18 · Vite 6 · TypeScript (strict) · React Router v7 (`createBrowserRouter`) ·
Tailwind CSS v4 (Oxide, CSS-first `@theme`) · Axios with interceptors · TanStack Query v5 ·
TanStack Table v8 · react-hook-form + Zod · MapLibre GL JS (WebGL) · Socket.IO client ·
Recharts · Vitest + Playwright · AWS S3 + CloudFront

## Commands

```
npm run dev       Dev server on :3000
npm run build     Typecheck + production build
npm run preview   Serve the real bundle locally  ← test this before deploying
npm run verify    typecheck + lint + test + build. The pre-push gate.
npm run test      Vitest
npm run e2e       Playwright against a preview build
```

## Architecture in three paragraphs

**Auth is a dual-token scheme.** The 15-minute access token lives in a module closure — never in
`localStorage`, because anything Web Storage holds is exfiltrable by a single XSS payload. The
7-day refresh token lives in an `HttpOnly; Secure; SameSite=Strict` cookie that JavaScript
physically cannot read. The cost is that a page refresh destroys the access token, which is why
the app performs a silent `/auth/refresh` on boot before rendering anything.

**The Axios interceptor layer is the integration seam.** It injects the bearer token on every
request and, on a 401, suspends the failed call, refreshes, and replays it invisibly. Refreshes
are *serialised*: the dashboard opens four requests at once, and because Person 3 rotates refresh
tokens, one refresh per failure would invalidate the others and force a logout. The first 401
refreshes; the rest queue and replay.

**Authorisation is the API's job.** Route guards compose as parent routes so a new screen inherits
the right protection by placement — but they are usability, not security. Delete every guard and a
user could reach any URL, and would simply receive 403s from Express. That is the boundary
(OWASP A01).

## Two deployment failures worth knowing before you deploy

1. **CloudFront must map 403 and 404 to `/index.html` with a 200.** Otherwise every deep link and
   every page refresh returns raw XML. Invisible locally, because Vite's dev server has the
   fallback built in. See `aws/DEPLOYMENT.md`.
2. **Safari 16.3 and older cannot parse Tailwind v4's `color-mix()` output**, which collapses grid
   layouts into overlapping containers. `src/index.css` carries `@supports` flexbox fallbacks;
   layout containers must keep their `kpi-grid` / `split-grid` hooks or the fallback silently
   stops applying.
