# Decisions

This project was originally built as four independent quadrants against a shared spec
(`PNSM_4Person_Bulletproof_Plan.pdf`), each written without the others able to negotiate
in real time. That produced a set of genuine, documented disagreements between quadrants —
this doc records how each one was resolved so the codebase can move forward consistently.
Each entry keeps the original conflict ID from the source reports so it's traceable back to
where it was first raised.

Format: **what the conflict was → what was decided → why → what it touches.**

## B1 — Refresh token delivery

**Conflict:** The blueprint wants the refresh token *only* in an `HttpOnly` cookie. Person 3
implemented "issue both" (cookie **and** response body) because Person 2's `api-client.ts`
reads `refreshToken` from the body, and Capacitor WebViews are unreliable with cookies
across the native bridge. Person 2's own `03-MERGE-GUIDE.md` separately listed "refresh
token must be in an HttpOnly cookie, never in the JSON body" as a thing that would break
integration — the two documents read as opposite positions.

**Decision: keep "issue both."** The cookie gives real XSS hardening for browser contexts
that can use it; the body covers Capacitor and any server-to-server caller that structurally
can't rely on a cookie jar. This is not a compromise of security posture — it's additive,
not a replacement of the cookie with the body.

**Touches:** Person 3 (already implemented, no change needed), Person 2 (its
`api-client.ts`/token-store keeps reading the body field as-is — no change needed either),
Person 1 (verify the mobile client's HTTP layer reads the body token, not just relying on
the cookie, since Capacitor is exactly the case this exists for).

## B2 — Face-match "rejected" vs "flagged," and the runtime-default clash

**Conflict:** The blueprint's own Quadrant IV text is self-contradictory ("flagged... status
is set to rejected"). Proposal FR-07, Person 2's entire review-queue UI, and ADR-5 all
expect a below-threshold match to be `flagged` for HR review. Person 3's backend hardcodes
`flagged`. But Person 4's AI service has a runtime toggle, `PNSM_DECISION_BANDS`, that
**defaults to the two-band master-plan model**, under which `flagged` is never actually
returned — so as shipped, the two already-written codebases silently disagree, not just the
docs.

**Decision: keep `flagged`, and set `PNSM_DECISION_BANDS=three` as the standing
configuration for Person 4's service.** Auto-rejecting a low-confidence match removes the
human review step that HR depends on and that FR-07 requires; `rejected` stays reserved for
hard business-rule failures (PIN, geofence, mock location, liveness), not an ambiguous face
match.

**Touches:** Person 4 (set `PNSM_DECISION_BANDS=three` in its default env/config, not just
document it as an option), Person 3 (no code change, its `flagged` default was already
correct), Person 2 (its review-queue UI's assumption was correct all along).

## B3 — MongoDB Atlas tier / B4 — AWS vs Render+R2

**Conflict:** Blueprint mandates Atlas M10+ (~$57/month) and full AWS ECS/CloudFront.
The graded proposal budgets Atlas M0 free tier and Render/Koyeb + Cloudflare R2.

**Decision: moot for now.** Local dev-complete scope runs a local MongoDB and a local
S3-compatible store (MinIO — Person 4's storage code already supports this for local dev)
via docker-compose. No cloud account, real or free-tier, is provisioned as part of this
phase. When an actual deployment phase happens, this decision needs revisiting with real
budget/ownership input — recorded here as open, not resolved.

**Touches:** Person 4 (docker-compose local stack), Person 3 (connection strings point at
local Mongo/MinIO via env vars, not hardcoded).

## B5 — Node `slim` vs Alpine base image

**Decision: no change — Alpine stays.** Already correctly justified: the backend
deliberately uses `bcryptjs` (pure JS, zero native deps) specifically so Alpine's musl libc
is a non-issue, and it produces a smaller image.

## B6 — Rollup of older open items

- **Work week (Sun–Thu vs Mon–Fri):** decided **Sun–Thu**, matching the project's
  Bangladesh/NSU context (also consistent with Person 2's Bangla-locale handling
  elsewhere in the risk register).
- **PIN length:** decided **exactly 4 digits** — matches what Person 3's backend already
  enforces; the proposal's "4–6 digits" language is superseded by this.
- **Mobile auth contract (ADR-6):** resolved by the PIN transmission decision below.
- **Collection count (8 in the proposal vs 14 delivered):** accepted as-is — 14 is the real,
  correct schema (13 domain models + the decoupled `FaceEmbedding` collection from B-A8).
  This is a documentation-currency issue for the original proposal writeup, not a code
  change.

## B7 — Background heartbeat endpoint

**Conflict:** Person 1's mobile client fires a heartbeat every 15 seconds to prove the
device is alive even when stationary. No backend endpoint for it existed.

**Decision: build it.** A lightweight `POST /mobile/heartbeat`, rate-limited per device,
backed by a capped/TTL collection (not unbounded inserts, given the volume). Scheduled as
part of Backend's Phase-2 work — see `ROADMAP.md`.

## PIN transmission — raw vs hashed (Person 1's Open Issue #1, labeled BLOCKER)

**Conflict:** The blueprint contradicts itself — Quadrant I's spec says send a *hashed* PIN;
Quadrant III's spec says the backend does `bcrypt.compare()` against a stored hash, which
needs the plaintext (bcrypt's salt is embedded per-hash, so you cannot compare two
independently-hashed values). The API contract says send the raw PIN.

**Decision: raw PIN over TLS, hashed server-side with bcrypt** (+ Person 4's
`pin_hash`/`pin_algo: "bcrypt-hmac-sha256-pepper"`/`pin_pepper_version` pepper scheme,
which already assumes this and is the only option actually compatible with a
bcrypt-compare backend). Hashing the PIN client-side before sending it would be security
theater against this design — an attacker who captured the "hashed" value could replay it
exactly as if it were the real credential, since bcrypt-compare needs the plaintext, not a
client-computed digest. TLS in transit is the actual protection here, matching how normal
password auth works everywhere else.

**Touches:** Person 1 (already implemented raw-PIN as its default, per its own README —
this decision confirms that was the right call, no rework needed), Person 3 (bcrypt-compare
against the pepper-augmented hash, per Person 4's schema), Person 4 (owns the pepper
scheme and hash generation).

## Broken doc references

Person 3's `README.md` references `PNSM_Backend_Architecture_Report.md` and
`PNSM_Backend_ADR.md` as design-decision sources. Neither file exists anywhere in this
project. **Decision:** repoint those references at this file (`DECISIONS.md`) and
`ROADMAP.md`, which now serve that purpose.
