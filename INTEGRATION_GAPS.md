# Integration Gaps & Open Decisions

This is a **tracking doc, not a fixed-by-this-merge list**. Everything below was found by
reading each quadrant's own documentation (`Person3_BackendAPI/PNSM_Person3_Blueprint_Alignment.md`,
`Person2_WebDashboard/docs/*`, `Person4_AIBiometricService/docs/*`,
`Person1_MobileClient/README.md`) — nothing here was invented for this merge, and nothing
here has been resolved by this merge. When an item gets decided, update its entry with
**strikethrough + date + who decided** rather than deleting it, so the decision trail
survives.

## Cross-team conflicts (B1–B7, from Person 3's Blueprint Alignment report)

### B1 — Refresh token delivery ⚠️
Blueprint says the refresh token should live **only** in an `HttpOnly` cookie. Person 3
implemented "issue both" instead — cookie *and* response body — because Person 2's
`api-client.ts` reads `refreshToken` from the body and Capacitor WebViews are unreliable
with cookies across the native bridge. **Needs confirmation from Person 1 and Person 2.**
See also the cross-cutting note below — Person 2's own merge guide currently reads as a
rejection of this "issue both" compromise.

### B2 — Face-match "rejected" vs "flagged" ⚠️
The blueprint's own Quadrant IV text is self-contradictory ("flagged... status is set to
rejected"). Proposal FR-07, Person 2's entire review-queue UI, and ADR-5 all expect a
below-threshold match to be `flagged` for HR review, not auto-`rejected`. Person 3 kept
`flagged`. **Needs confirmation.** See also the cross-cutting note below — this is not just
a docs disagreement, the two codebases currently default to opposite behavior.

### B3 — MongoDB Atlas tier 💰
Blueprint says M10+ (~$57/month). The graded proposal budgets the M0 free tier. Person 3's
recommendation is to stay on M0 for the course project. **Needs someone to confirm nobody
is expected to pay for M10 this semester.**

### B4 — AWS vs Render/Cloudflare R2 💰
Blueprint mandates the full AWS ECS/CloudFront stack. The submitted, graded proposal specs
Render/Koyeb + Cloudflare R2 free tiers instead — AWS ECS Fargate has no meaningful free
tier. Person 3's storage layer works with either (provider-agnostic). **This is Person 4's
call to make**, since it's Person 4's deployment topology and cost basis either way.

### B5 — Node base image: `node:24-slim` vs Alpine
Blueprint prefers `slim` because Alpine's musl libc can break native C++ builds. Person 3
deliberately uses `bcryptjs` (pure JS, zero native deps) specifically so Alpine is safe, and
kept Alpine for the smaller image. Low-stakes — flagged for awareness, not urgent.

### B6 — Older still-open items, unchanged by the blueprint
- **Work week (Sun–Thu vs Mon–Fri)** — still unanswered (ADR-3).
- **Mobile auth contract** — still the hard blocker on wiring mobile routes (ADR-6); the
  blueprint's Capacitor + HttpOnly-cookie design makes this more urgent, not less.
- **PIN length** — proposal allows 4–6 digits, implementation enforces exactly 4. See the
  PIN transmission item below — these two are facets of the same open conversation between
  Person 1 and Person 3.
- **Collection count** — proposal §4.1 lists 8 collections, the database now has 14
  (13 + `FaceEmbedding`). Needs a proposal revision or the submitted spec won't match what
  actually ships.

### B7 — Background heartbeat has no backend endpoint yet
Person 1's mobile client fires a heartbeat every 15 seconds to prove the device is alive
even when stationary. Nobody has specified a backend endpoint for it, and at 15s intervals
it would be the highest-volume route in the whole system — it needs its own rate-limit
budget and likely a capped/TTL collection rather than unbounded inserts. **Not built.**

## Cross-cutting mismatches (found by reading across quadrants — not stated as a single item anywhere)

- **B2 is a live default clash, not just a docs disagreement.** Person 3's code hardcodes
  `flagged`. Person 4's AI service has a runtime toggle (`PNSM_DECISION_BANDS`) that
  **defaults to the master-plan two-band model, under which `flagged` is unreachable**. As
  the two services stand today, wiring them together will never produce a flagged
  review-queue item — contradicting Person 2's review-queue UI — until someone sets the env
  var or changes Person 3's code.
- **B1 vs. Person 2's own merge guide.** Person 3's resolution to B1 is "issue both cookie
  and body." Person 2's `docs/03-MERGE-GUIDE.md` lists "refresh token must be in an
  HttpOnly cookie, never in the JSON body" as one of five things that will break
  integration. These need to be reconciled explicitly — right now they read as opposite
  positions from two people who haven't talked to each other about it yet.

## PIN transmission — blocker, spans three quadrants

- **Person 1's README, Open Issue #1 (labeled BLOCKER):** the blueprint contradicts itself
  — Quadrant I's spec says send a *hashed* PIN, Quadrant III's spec says the backend does
  `bcrypt.compare()` against a stored hash (which needs the plaintext, since bcrypt's salt
  is embedded per-hash), and the API contract says send the raw PIN. Person 1 implemented
  raw-PIN transmission (the only option compatible with bcrypt) and gated the hashed path
  behind a disabled flag. **Needs Person 3 to explicitly confirm bcrypt-over-plaintext.**
- Ties directly into **B6's PIN-length note** above (4 vs 4–6 digits) — same two people,
  same unresolved conversation, two facets of it.
- **Already-shipped evidence toward an answer:** Person 4's AI service already ships a
  `pin_hash` / `pin_algo: "bcrypt-hmac-sha256-pepper"` / `pin_pepper_version` schema for
  Person 3's `Users` collection, which presumes raw-PIN transmission — consistent with what
  Person 1 already implemented. Worth treating as a data point toward resolving this, not a
  new open question.

## Missing backend routes (Person 3, explicitly "Phase 2" per that folder's own README)

Only `auth` (`login`/`refresh`/`me`/`logout`) and `health` routes exist. **Not yet built:**
the check-in pipeline itself, and all employee, geofence, attendance, leave, dashboard,
mobile, and Super-Admin routes. This is the single biggest blocker to an end-to-end working
system — everything Person 1 and Person 2 built assumes these exist.

## Broken doc references

`Person3_BackendAPI/README.md` references `PNSM_Backend_Architecture_Report.md` and
`PNSM_Backend_ADR.md` as the design-decision source docs. **Neither file exists anywhere in
this repo** (confirmed by search across the entire source tree before this merge). Either
those files exist somewhere else and need to be added, or the README's references need
updating.

## Never actually executed / unverified

None of the four quadrants were built with a working install/build/test loop in their
authoring environment (no network egress and/or no relevant runtime available). Concretely:

- **Person 1:** static/syntax checks passed; `npm test` was **never actually run**; no
  device or emulator testing was done at all.
- **Person 3:** TypeScript compiles clean, but `npm install`, `npm run build`, and the test
  suite were never run (no network egress, no Docker binary in the authoring sandbox).
- **Person 4:** 389 tests reportedly pass via a dependency-free fallback runner
  (`scripts/verify_offline.py`), but `tests/api/test_routes.py` and
  `tests/contract/test_openapi.py` — both of which need FastAPI actually installed — have
  **never been executed**.

Before treating any quadrant as "done," someone needs to actually run
`npm install && npm run build && npm test` (or the Python equivalent) on a real machine.

## Person 4 — outstanding before any demo

- `calibration/calibration.json` is a **bootstrap placeholder**, not measured data
  (`provenance: "BOOTSTRAP - literature defaults, NOT measured"`, `identities: 0`,
  `images: 0`, `far: null`, `frr: null`). Run `make calibrate` on real team photos before
  relying on the face-match threshold.
- `models/` has no downloaded ONNX weights and no `checksums.txt` yet — run `make models`.
- `bench_bcrypt.py` hasn't been run against the deployed container to pick a real cost
  factor.
- `docs/openapi.json` doesn't exist yet — needs generating.
- `requirements.lock` needs generating (`make lock`).

## Housekeeping

- `Person4_AIBiometricService/_restore/` (`Makefile.txt`, `ci.yml.txt`,
  `README-RESTORE.md`) is **vestigial** — both files it describes restoring
  (`Makefile`, `.github/workflows/ci.yml`) are already correctly in place at the project
  root, confirmed byte-identical. Safe to delete once the team confirms the same locally.
