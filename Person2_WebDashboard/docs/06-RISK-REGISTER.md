# Risk Register

What can still go wrong, how likely, and the mitigation that is **already built**. Ordered by
expected damage.

---

### R1 · CloudFront returns XML on any deep link or refresh
**Likelihood:** high if not configured · **Impact:** total — the deployed app looks broken

**Mitigation (built + documented).** Custom Error Responses mapping 403 **and** 404 to
`/index.html` with a 200 (`aws/DEPLOYMENT.md`, `aws/cloudfront-error-responses.json`), the
nginx `try_files` equivalent in `nginx.conf`, and an e2e test that reloads a deep link.

**Why it ranks first:** it is invisible locally. Vite's dev server has the fallback built in, so
this bug appears for the first time on the deployed URL — often the night before.

---

### R2 · Person 3's backend is not ready when the demo is
**Likelihood:** medium · **Impact:** would be total

**Mitigation (built).** `VITE_DEMO_MODE=1` runs everything on an in-process mock with seeded
data and a simulated live feed. Every screen, write and export works. An amber banner says
plainly that it is demo data.

**Trigger.** If the live API is not answering 20 minutes before presenting, switch and redeploy.

---

### R3 · Session breaks in ways that look like a broken login
**Likelihood:** medium · **Impact:** high

Three distinct failure modes, all mitigated:
- *Signed out on every refresh* → silent boot refresh, with a spinner rather than a redirect
  while it resolves.
- *Logged out after 15 minutes* → serialised refresh-and-replay in the Axios interceptor.
- *Cookie never sent* → `withCredentials` on our side; explicit origins + `credentials: true`
  on Person 3's side, requested in writing in `04-MESSAGES-TO-TEAM.md`.

**Verified by** `src/tests/auth-refresh.test.ts` (9 cases) and the merge-day checklist items
that specifically test a refresh and an idle-past-expiry click.

---

### R4 · Safari 16.3 collapses the dashboard on an older iPad
**Likelihood:** medium · **Impact:** high in front of an examiner

**Mitigation (built).** `@supports` feature queries in `src/index.css` supplying flexbox
fallbacks to agents lacking `color-mix()`. Playwright runs a WebKit project locally.

**Residual.** WebKit in Playwright is not identical to Safari 16.3 on device. If an older iPad
is available, check it once before the demo.

---

### R5 · S3 upload fails with an opaque error
**Likelihood:** medium · **Impact:** medium — blocks onboarding

**Mitigation (built).** The upload uses plain `fetch` with `credentials: 'omit'` and an exactly
matching `Content-Type` — the two client-side causes of a 403. The bucket CORS JSON is written
ready to paste. If no bucket is configured, `mode: 'demo'` keeps onboarding working end to end.
The error message names CORS explicitly, because the browser's does not.

---

### R6 · Venue WiFi blocks WebSockets
**Likelihood:** medium · **Impact:** low with mitigation

**Mitigation (built).** `transports: ['websocket', 'polling']` falls back to long-polling
automatically. The connection indicator states the truth either way. In demo mode the simulated
socket is in-process and needs no network at all.

**Related:** a CSP missing `wss://` in `connect-src` produces the same symptom for a different
reason — flagged in `02-BUG-BIBLE.md` §9 and in the message to Person 4.

---

### R7 · The drawn geofence and the enforced geofence disagree
**Likelihood:** low · **Impact:** high, and silent

If our circle geometry and Person 3's `$centerSphere` radius drift, HR sets a boundary that is
not the one enforced, and legitimate check-ins are rejected with no visible cause.

**Mitigation (built).** `src/lib/circle.ts` uses the identical constant (6,378,137 m), and
`src/tests/circle.test.ts` asserts every polygon vertex sits within 1% of the requested ground
distance via an independent Haversine calculation. Merge-day checklist includes a physical
45 m-passes / 60 m-fails test.

---

### R8 · WebGL contexts leak and the map goes blank
**Likelihood:** low · **Impact:** medium

Browsers cap live WebGL contexts. StrictMode doubles the creation rate.

**Mitigation (built).** Both map components `remove()` the map and markers on unmount, and the
instance is created once — props are synced by mutating sources in place rather than
remounting.

---

### R9 · A dependency upgrade breaks the build
**Likelihood:** low · **Impact:** high

**Mitigation.** Versions carry deliberate floors with reasons recorded in `00-PLAN.md`.
**Do not run `npm update` before the demo.** Commit `package-lock.json`; CI uses `npm ci`, which
fails if the lockfile and manifest disagree.

---

### R10 · A poisoned transitive dependency
**Likelihood:** low · **Impact:** severe (OWASP A03)

**Mitigation (built).** A dedicated CI job runs `npm audit --audit-level=high` and halts the
pipeline. Deployments use `npm ci` against the committed lockfile, never `npm install`.

---

### R11 · Load shedding or an unreliable link mid-demo
**Likelihood:** medium (Dhaka) · **Impact:** medium

**Mitigation (built).** The query cache persists to IndexedDB, so reopening after a reboot shows
the last known data immediately and refreshes in the background. An offline indicator appears in
the topbar.

**Also.** Keep the demo open in a second, already-loaded window.

---

### R12 · Someone assumes route guards are security
**Likelihood:** medium · **Impact:** high if it ships

**Mitigation (built).** `protected-route.tsx` and `rbac-gate.tsx` both carry an explicit comment
stating they are usability, not access control, and that Express is the boundary (OWASP A01).
The e2e suite verifies HR is redirected away from `/billing` — a UI check, not a security claim.

---

### R13 · Bangla names blank in the PDF
**Likelihood:** high **if** real Bangla names are used · **Impact:** low–medium

jsPDF's built-in fonts are Latin-1 only. `registerBanglaFont(base64Ttf)` accepts a Noto Sans
Bengali TTF; `hasBanglaText()` lets the UI warn instead of silently emitting blanks. CSV is
unaffected (UTF-8 BOM). **Residual:** the font file is not bundled (~400 KB); register it if the
demo uses Bangla names.

---

## Pre-demo risk review (day before)

- [ ] `npm run verify` green
- [ ] `npm run e2e` green, including the deep-link reload test
- [ ] Demo mode verified on the **deployed** URL
- [ ] Live mode verified on the deployed URL
- [ ] Deep link + hard refresh works on the deployed URL
- [ ] Backend warmed within the last 10 minutes
- [ ] Deployed URL in Express CORS, Socket.IO CORS, and S3 bucket CORS
- [ ] `package-lock.json` committed; no `npm update` this week
- [ ] Bangla font registered **or** demo data confirmed ASCII
- [ ] Second browser window open with the dashboard already loaded
