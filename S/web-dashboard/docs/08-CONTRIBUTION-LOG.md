# Contribution Log — Person 2

**Quadrant II: Web Command Center and Real-Time Telemetry**
CSE482L Internet and Web Technology · Summer 2026 · North South University · Group 8

---

## Requirements delivered

| ID | Requirement | Where |
| --- | --- | --- |
| FR-01 | Employee onboarding with reference-photo capture | `/employees/new`, `/employees/:id` |
| FR-02 | Geofence definition — anchor pin + radius slider on a WebGL map | `/geofences` |
| FR-05 | Mock-location anomalies surfaced to HR | attendance badges, `/settings` |
| FR-07 | The 85% cosine threshold made legible and actionable | `ConfidenceBar`, `/flagged` |
| FR-09 | Real-time HR telemetry over Socket.IO | live feed, `use-socket` |
| FR-10 | Attendance dashboard and CSV/PDF reporting | `/dashboard`, `/attendance`, `/reports` |
| FR-12 | Role-based access across the interface | `lib/rbac.ts`, route guards |
| — | Flagged check-in review workflow | `/flagged` |
| — | Leave approvals | `/leave` |
| — | Live workforce map | `/live-map` |
| — | Super Admin: accounts, policy, audit, billing | `/admins`, `/policy`, `/audit`, `/billing` |

Wireframes **Fig 3.4** (dashboard) and **Fig 3.5** (add employee) are reproduced field for field.

## Scale

- **105** TypeScript/TSX source files
- **17** routes + 4 nested route guards
- **7** test suites (Vitest) + a Playwright smoke suite
- **9** documentation files carrying the full plan, contract and merge context
- AWS deployment configuration: CloudFront error responses, S3 cache policy, CSP, multi-stage
  Dockerfile, nginx config

## Decisions worth defending in the viva

1. **Access token in memory, refresh token in an HttpOnly cookie.** Web Storage is
   XSS-readable; a token in a module closure is not. The accepted cost — a refresh destroys the
   token — is paid by a silent boot refresh, not by weakening the design.
2. **Serialised refresh with a replay queue.** The concurrency case is the one that actually
   bites: four parallel 401s, rotating refresh tokens, and a naive implementation logs the user
   out. Nine tests pin the behaviour.
3. **MapLibre GL over Mapbox GL JS.** Same API, WebGL rendering, no mandatory access token — so
   the map works for every teammate and cannot be rate-limited during a demo. Migration is
   confined to one file.
4. **A single coordinate conversion layer with an active flip detector.** The project's most
   dangerous silent bug, closed by construction and guarded by tests. MapLibre's `LngLat` order
   removes the map-boundary risk that Leaflet would have introduced.
5. **Circle geometry that mirrors `$centerSphere`.** The drawn boundary uses the same
   6,378,137 m constant the database enforces, verified against an independent Haversine
   calculation.
6. **Timezone-pinned formatting.** Removes the UTC+6 day-boundary bug and a class of rendering
   inconsistency at once.
7. **Demo mode as an Axios adapter.** It sits below the interceptors, so the auth header, the
   401 replay and the error normalisation all run exactly as in production — and it doubles as
   an executable contract test for Person 3.
8. **Route guards are documented as usability, not security.** OWASP A01 compliance is Express
   re-checking every request.

## Testing

| Suite | Covers |
| --- | --- |
| `tests/auth-refresh.test.ts` | Bearer injection, 401 refresh-and-replay, **single refresh under concurrent 401s**, no-recursion guards, token never in storage |
| `tests/geo.test.ts` | Coordinate round trip, reversed-payload rejection, bounds, distance |
| `tests/circle.test.ts` | Radian parity with `$centerSphere`, vertex distance accuracy, GeoJSON order |
| `tests/tz.test.ts` | Dhaka day boundaries, late-arrival rule, timezone-independent formatting |
| `tests/rbac.test.ts` | Role mapping, permission matrix, privilege separation |
| `tests/socket-lifecycle.test.tsx` | One connection under StrictMode, full listener cleanup |
| `tests/mock-api.test.ts` | API contract: envelope, pagination, coordinate order, onboarding |
| `e2e/smoke.spec.ts` | Auth redirect, dashboard, **deep-link reload**, WebGL map, export, RBAC |

CI runs typecheck, lint, unit tests and a production build on every push, plus a separate
`npm audit --audit-level=high` supply-chain gate (OWASP A03).

## Submission checklist

- [ ] `npm run verify` green
- [ ] `npm run e2e` green
- [ ] Deployed to S3 + CloudFront; URL recorded in the group report
- [ ] **Deep link + hard refresh verified on the deployed URL**
- [ ] Screenshots captured of all 17 screens for the report
- [ ] `docs/01-API-CONTRACT.md` sent to Person 3
- [ ] `docs/04-MESSAGES-TO-TEAM.md` requests sent to Persons 1, 3 and 4
- [ ] Wireframe comparison (Fig 3.4 / 3.5 vs implementation) in the report
- [ ] `package-lock.json` committed; `.env.local` **not** committed

## Notes for the report

Lead the architecture section with the dual-token decision — it explains more about the codebase
than anything else: why there is a token store, why the interceptor has a queue, why the app
performs a network call before it renders, and why route guards are documented as cosmetic.

The six silent failures in `02-BUG-BIBLE.md` make good discussion material precisely because
none of them produces an error message: the CloudFront 404, the Safari 16.3 collapse, the
coordinate flip, the UTC+6 boundary, the parallel-refresh logout, and the StrictMode double
socket.
