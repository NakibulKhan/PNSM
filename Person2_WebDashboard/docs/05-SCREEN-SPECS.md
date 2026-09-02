# Screen Specifications

Every screen: route, requirement, who can reach it, what it calls, and how it behaves when
things are missing or broken. Use this as the acceptance checklist.

**Roles:** `SA` = Super Admin · `HR` = Admin/HR. Employees cannot sign in at all
(`/auth/login` returns 403 for them).

**Route protection** composes as parent routes in `src/router/routes.tsx`:
`RequireAuth` → `AppLayout` → `RequirePermission`. A new screen inherits the correct guard by
being placed in the right branch. This is usability, not security — Express re-checks every
request (OWASP A01).

---

## `/login`
**Access:** public · `src/pages/login.tsx`

Left panel states what the system does in its own vocabulary (verification threshold, geofence
radius, live telemetry). Right panel is the form.

- Zod validation, inline, on blur and submit.
- Wrong credentials → the API's own message in a red `role="alert"` panel.
- An employee-role account → "This console is for HR and Super Admin accounts."
- Arriving after a session expiry shows "Your session expired. Sign in again to continue."
- Demo mode adds one-click account buttons.
- On success, `RedirectIfAuthenticated` returns the user to the page they originally requested
  (captured in router location state), else `/dashboard`.

## Boot behaviour (every route)
`AuthProvider` calls `/auth/refresh` on mount. While `status === 'loading'`, `RequireAuth`
renders `FullPageSpinner` — **not** a redirect. Redirecting during that window would sign out
every returning user on every page load, which is the classic memory-token mistake.

---

## `/dashboard` — Live operations (wireframe Fig 3.4)
**Access:** SA, HR · **FR-09, FR-10**

| Element | Source | Notes |
| --- | --- | --- |
| Checked In Today | `GET /dashboard/kpis` | distinct employees, Dhaka calendar day |
| On Leave | same | approved absences covering today |
| Late Arrivals | same | after the 09:15 Dhaka cutoff |
| Avg Face Match | same | coloured against the 85% threshold |
| Live Check-In Feed | `GET /attendance/feed` + socket `attendance:new` | newest first, capped at 40 |
| Attendance Trend | `GET /dashboard/trend?days=7` | last bar is today, drawn in accent so a partial day isn't misread as a drop |

Layout containers carry `kpi-grid` and `split-grid` hooks — these drive the Safari 16.3 flexbox
fallbacks. Removing a hook silently removes the fallback.

**States.** Loading → skeletons matching the final layout. Empty feed → "No check-ins yet".
KPI failure → one quiet line, never a blank card grid. Socket down → the topbar reads
*Feed offline* and fetched history still renders.

**Real-time.** New rows animate once with an accent rule. Arrival invalidates the KPI and trend
queries, so the numbers can never disagree with the feed.

---

## `/employees` — Directory
**Access:** SA, HR · **FR-01**

Server-paginated table. Debounced search across name, code, email and department; office
filter; CSV export of the current page. Columns: employee, department, assigned office, mobile,
biometric baseline (Enrolled / No baseline — derived from `has_face_embedding`, never the
vector), status.

"Add employee" is gated behind `employee:write`.

---

## `/employees/new` — Onboarding (wireframe Fig 3.5)
**Access:** SA, HR (`employee:write`) · **FR-01**

Every field from the wireframe: Full Name, Employee ID, Department, Shift Timing, Assigned
Office (Geofence), Geofence Radius (m), Upload Reference Profile Photo, CREATE PROFILE — plus
work email and mobile, which the system needs and the wireframe omitted.

**Photo pipeline**, with a distinct state per step so the user knows what they are waiting for:
1. type/size validation (JPEG or PNG, under 25 MB)
2. compression below 200 KB in a web worker, EXIF orientation preserved
3. `POST /uploads/presign` for a short-lived S3 URL
4. direct PUT to S3 (plain `fetch`, `credentials: 'omit'` — never our JWT)
5. the public URL is handed to the form

Radius follows the selected office and writes back to that office's geofence if changed.
On success the generated 2FA PIN is shown **once** in a green panel, with a warning that it will
not be shown again.

**Validation:** Bangladeshi mobile `01[3-9]XXXXXXXX`; employee code `[A-Za-z0-9-_]`; a reference
photo is mandatory.

---

## `/employees/:id` — Profile
**Access:** SA, HR

Identity, biometric baseline status, assigned office, shift, onboarding date, embedding model
version, and **"Biometric storage: isolated collection, AES-256-GCM encrypted"** — stated
explicitly so an auditor can see the isolation without reading code. Then the last 25 attendance
events with a confidence bar each, plus an average.

Photo replacement (`employee:write`) reruns the upload pipeline and regenerates the embedding.
Deactivation (`employee:deactivate`, SA only) is a **soft** delete: history retained, future
check-ins blocked.

---

## `/geofences` — Spatial wizard
**Access:** SA, HR · **FR-02**

Office list left, WebGL editor right.

- Drag the pin or click the map; the vector circle follows live.
- Radius slider 10–1000 m, plus named presets: **Indoor office 50 m · Compound 150 m ·
  Construction site 500 m**. Naming the situation is more useful than asking HR to guess a number.
- Centre coordinates shown in human form (`23.792500 N, 90.415200 E`) **and** the GeoJSON form
  that will be stored, so ordering is visible rather than implied.
- A pin outside Bangladesh raises an amber "coordinates may be reversed" warning.
- **Verification gate (FR-02):** saving is disabled until the pin is explicitly confirmed;
  moving the pin clears the confirmation.
- The payload is validated by `geoJSONPointSchema` before sending, rejecting a reversed tuple.

The circle is real ground geometry generated with the same `metres / 6378137` constant Person 3
feeds to `$centerSphere`, so the drawn boundary is the enforced boundary.

---

## `/attendance` — Attendance log
**Access:** SA, HR · **FR-10**

Filters: date range (Dhaka calendar dates), office, verification status, reset. Server-side
pagination. Columns: employee, office, date/time, type, face match (confidence bar), GPS,
status — with a "Spoofed GPS" badge where `mock_location_detected` is true.

Export CSV or PDF over the **whole filtered range**, not just the visible page.

**The subtle part:** the picker takes Dhaka dates; the query carries UTC instants for those
Dhaka boundaries via `dhakaDayStartUtc` / `dhakaDayEndUtc`. Without that, the last six hours of
every day disappear.

---

## `/flagged` — Review queue
**Access:** SA, HR (`attendance:review`)

One card per below-threshold check-in with everything needed to decide without navigating away:
selfie, name and code, timestamp, office, GPS reading, confidence bar, and the exact shortfall
("3.4 points below the 85% threshold").

Approve/Reject are **optimistic** — the row leaves immediately and is restored with an error
toast if the write fails. A queue of twenty is unusable if each decision waits for a round trip.

Sidebar badge shows the pending count, refreshed on socket events.

---

## `/leave`
**Access:** SA, HR (`leave:read`; decisions need `leave:write`)

Filter by status. Each card: employee, date range with day count, reason. Approved absences feed
the "On leave" KPI.

---

## `/live-map`
**Access:** SA, HR (`livemap:view`)

WebGL map of employees whose latest event today is a check-in, drawn against every office
geofence polygon. Markers are tinted by verdict (green verified, amber below threshold) and
reconciled by employee id in a `Map`, so an update repositions a pin rather than stacking one;
employees who check out have their pin removed. Side panels: headcount by office and a
scrollable present-employee list. Polls every 30 s in addition to socket updates, because a
check-out elsewhere changes who is on site without producing a check-in event here.

---

## `/reports`
**Access:** SA, HR (`report:export`) · **FR-10**

Date range, office scope, quick presets, and a live summary before exporting: records,
employees covered, average face match, exception count.

- **CSV** carries a UTF-8 BOM so Excel does not mangle Bangla names, and includes GPS columns.
- **PDF** is landscape A4 with a header block (period, office, record count, threshold,
  generated by) and marks every below-threshold score in red.
- jsPDF is dynamically imported on click and lives in its own Rollup chunk.

Generation is client-side, so a sleeping backend cannot block a report for data already loaded.

---

## `/settings`
**Access:** SA, HR (`settings:read`)

Account details, the permission list for the signed-in role (stated explicitly rather than
implied by which menu items appear), the verification rules in force, whether the data source is
live or demo, the build version (so a stale CloudFront cache is identifiable), and **spoofing
alerts** — blocked mock-location attempts (FR-05), a security event HR must see even though no
check-in was recorded.

---

## Super Admin screens
**Access:** SA only. HR is redirected to `/dashboard` by `RequirePermission`, and the whole nav
group is hidden.

| Route | Permission | Contents |
| --- | --- | --- |
| `/admins` | `admin:manage` | Accounts that can sign in, with role and status |
| `/policy` | `policy:write` | Face-match threshold, default radius, late cutoff, mock-location handling — copy states the consequence of each change |
| `/audit` | `audit:read` | Administrative actions, CSV-exportable |
| `/billing` | `billing:read` | Plan, seats, monthly cost, per-service breakdown |

---

## Cross-cutting

**Responsive.** Sidebar becomes an off-canvas panel below `lg`. Tables scroll horizontally with
a minimum width rather than reflowing into unreadable columns. KPI cards 4-up → 2-up. Verified
at 1440 / 1024 / 768 / 390 px.

**Accessibility.** Visible keyboard focus throughout; `aria-current` on the active nav item;
confidence bars expose a text label to screen readers; toasts are `aria-live="polite"`; maps
carry `role="application"` with a label; `prefers-reduced-motion` disables the one animation.

**Every data surface has four states:** loading (skeleton matching the final layout), empty (an
invitation to act), error (what happened and what to do), offline (topbar indicator plus cached
data from IndexedDB).

**Copy rules.** Errors don't apologise and are never vague. Actions keep the same verb through
the flow — "Approve" produces "Approved". Labels name what the person controls, not how the
system is built.
