# PNSM — Quadrant I: Mobile Edge Client (Person 1)

Vite + React 18 + Tailwind v4 + CapacitorJS 8, per the Definitive
Architectural Blueprint. This **replaces** the previous Expo / React Native
client, which is superseded and should not be developed further.

## Why this is a rewrite, not a refactor

The blueprint moves Quadrant I from React Native to "React 18 / Vite /
CapacitorJS". Those are not interchangeable: React Native renders to native
view primitives (`<View>`, `<Text>`, `StyleSheet`), while Capacitor renders
real DOM inside a WebView and styles it with CSS. Every screen, every style,
and every hardware call had to be rewritten. Business logic that was already
correct (geofence maths, the 200KB gate, contract-shaped payloads, response
interpretation) was carried across intact.

## Setup

```bash
npm install
npm run dev                 # browser dev build (no native hardware)

npx cap init                # if capacitor.config.json is ever regenerated
npx cap add ios
npx cap add android

# Apply native/ snippets NOW — see "Native configuration" below.

npm run sync                # vite build + npx cap sync
npm run open:android        # or open:ios
```

`webDir` is bound to `dist`, so **every** JS/CSS change requires
`npm run sync` before it appears in the native shell. Editing source and
rebuilding only in Android Studio will show stale assets.

```bash
npm test                    # vitest
npm run audit:capacitor     # version parity gate (see below)
```

## Architecture

```
src/
  lib/
    http.js                 axios instance; dual-token JWT interceptors
    api.js                  check-in contract client + response interpreter
    checkinService.js       the full check-in sequence (DI-based, testable)
    hardware.js             @capacitor/camera + @capacitor/geolocation bridges
    mockLocation.js         anti-spoofing (see platform caveat below)
    compression.js          canvas recursive JPEG downgrade -> <200KB
    geofence.js             Haversine pre-check + GeoJSON helpers
    backgroundTelemetry.js  heartbeat, shift-window guard, capability reporting
  state/AppContext.jsx
  components/               PinPad, StatusPill
  screens/                  Login, Home, CheckIn, Profile
  styles/index.css          Tailwind v4 @theme tokens + @supports fallbacks
native/                     Info.plist / AndroidManifest / ForegroundService
scripts/audit-capacitor-parity.mjs
```

### JWT dual-token handling (`lib/http.js`)

Access token in memory only — never `localStorage`, never Capacitor
Preferences, because persisted storage in a WebView is readable by injected
script and would defeat the 15-minute TTL. Refresh token is an HttpOnly cookie
the client never reads; `withCredentials` lets it ride along to `/refresh`.

On 401 the interceptor refreshes once and replays the original request. The
refresh is **single-flight with a waiter queue**: without that, N concurrent
401s fire N parallel refreshes, and with server-side rotation all but one get
invalidated, logging the user out spuriously.

### Check-in sequence (`lib/checkinService.js`)

`permissions → GPS fix → geofence → anti-spoof → capture → liveness →
compress → 200KB gate → submit`

Cheap local rejections come first so a doomed check-in never costs the
employee a selfie upload on mobile data. The sequence is a plain async
function with injectable dependencies, so it is testable without a device.

## Blueprint requirement coverage

| Quadrant I requirement | Where |
|---|---|
| Vite + React scaffold, `webDir` → `/dist` | `vite.config.js`, `capacitor.config.json` |
| `@capacitor/camera` selfie capture | `lib/hardware.js` |
| Canvas recursive JPEG compression < 200KB | `lib/compression.js` |
| `@capacitor/geolocation` coordinates | `lib/hardware.js` |
| Payload: selfie + lat/lng + ISO 8601 timestamp + PIN | `lib/checkinService.js`, `lib/api.js` |
| Mock-location inspection + local reject + anomaly dispatch | `lib/mockLocation.js`, `lib/checkinService.js` |
| Info.plist / AndroidManifest declarations | `native/` |
| Capacitor version parity audit | `scripts/audit-capacitor-parity.mjs` |
| Heartbeat timer, shift-window guard | `lib/backgroundTelemetry.js` |
| Android Foreground Service | `native/PnsmForegroundService.java` (scaffold) |
| Tailwind v4 `@theme`, `@supports` fallback | `src/styles/index.css` |
| Axios interceptor layer | `lib/http.js` |

---

# Open issues requiring team decisions

These are flagged rather than silently resolved. Each one is a place where the
blueprint is internally inconsistent, over-optimistic, or carries a
consequence outside my quadrant.

## 1. BLOCKER — the blueprint contradicts itself on PIN transmission

- **Quadrant I** says this client sends *"a hashed representation of the
  user's 2FA PIN."*
- **Quadrant III** says the backend does *"cryptographically comparing the
  supplied 2FA PIN against a stored bcrypt hash."*
- **`api-contract.md`** specifies `pin` — the PIN as entered.

Quadrants I and III cannot both be implemented as written. `bcrypt.compare()`
requires the plaintext, because bcrypt embeds a per-hash random salt — the
server cannot regenerate a client-side digest to compare against a stored
bcrypt hash. If this client sent SHA-256(pin), Person 3's documented
comparison would fail for **every employee, every time**.

Client-side hashing also buys nothing here: a 4-digit PIN has a 10,000-value
keyspace, so an unsalted digest is reversible instantly, and the digest simply
becomes the new replayable secret. Transport is already covered by the
TLS 1.2+ requirement.

**Implemented:** raw PIN per `api-contract.md` (the only option compatible
with Quadrant III). The alternative sits behind `CLIENT_SIDE_PIN_PREHASH` in
`lib/api.js`, default `false`.
**Needed:** Person 3 confirms bcrypt-over-plaintext, or commits to storing
`bcrypt(sha256(pin))`.

## 2. iOS anti-spoofing is substantially weaker than the blueprint implies

The blueprint treats Android `isFromMockProvider` and iOS
`isSimulatedBySoftware` as equivalent controls. They are not.

`CLLocation.sourceInformation.isSimulatedBySoftware` does exist (iOS 15+) —
an earlier revision of this client wrongly claimed iOS had no equivalent, and
that was corrected here. But Apple engineers have confirmed on the developer
forums that the flag is only set for **Core Location's own simulation**
(Xcode GPX injection). The commercial desktop spoofing tools an employee would
realistically use (LocaChange, iTool AnyTo) leave it `false` on current iOS.
There is also a trap: the flag is only populated on locations delivered
through the `didUpdateLocations` delegate — reading `CLLocationManager.location`
directly always reports `false`.

Additionally, `capacitor-mock-location-checker` (v0.3.1) is **Android-only** in
practice.

**Consequence:** iOS check-in spoofing is not reliably preventable at the
client. Do not describe iOS anti-spoofing as equivalent to Android in the
project report. `mockLocation.js` returns a `confidence` field
(`reliable` | `weak` | `unavailable`) so this is visible downstream rather
than assumed. Server-side compensating controls (impossible-travel detection,
IP/GPS correlation, device binding) are listed in that file for Persons 3/4 —
impossible-travel detection is the highest-value one and is platform-agnostic.

## 3. Background telemetry is foreground-only until native work lands

JavaScript inside a WebView is suspended when the OS backgrounds the app. No
JS timer survives Android Doze or iOS suspension. Real background telemetry
needs the native pieces in `native/` to be wired into the generated projects.

Until then `getTelemetryCapability()` reports `background: false` and the
Profile screen tells the employee tracking is foreground-only. This is
deliberate: **a silent tracking failure is worse than no tracking**, because
HR would trust attendance data that was never collected.

## 4. Decisions needed before either app store will accept this

- **Background location** requires an Apple justification for
  `UIBackgroundModes:location` and a Google Play Location Permissions
  declaration with a documented, user-visible purpose. Vague usage strings are
  a standard rejection reason.
- **`QUERY_ALL_PACKAGES`** (needed for the spoofing-app enumeration) is a Play
  *restricted* permission requiring a declaration form. If refused, `isMock`
  detection still works; only the "which spoofing app is installed" list is
  lost.
- **`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`** (the dontkillmyapp.com
  whitelist prompt) is Play-restricted to apps with a qualifying core purpose.
  Deliberately **not** implemented — shipping it unjustified risks rejection.
  `getBatteryOptimizationGuidance()` returns guidance instead.
- **Employee monitoring** is legally regulated in most jurisdictions and
  requires disclosure. `isWithinTrackingWindow()` enforces shift-hours-only
  tracking in code (with tests) so it is a property of the system rather than
  a promise in a policy document. The consent/disclosure position needs
  confirming with the project owners before this reaches real employees.

## 5. `geofence_id` contract ambiguity (carried over, still open)

`api-contract.md`'s request table omits `geofence_id` while its "Note on IDs"
references it. Behaviour is unchanged: the field is still sent, per the note.
Person 3 to confirm.

## 6. The 15-second heartbeat is a real cost

Per the blueprint, but at high-accuracy GNSS this is a material battery drain
across an 8-hour shift and produces ~1,920 writes per employee per day.
Configurable via `intervalMs`; flagged as a tuning decision rather than
buried.

## 7. Liveness is still a timed confirmation, not blink detection

Unchanged and still honest: there is no ML model verifying a blink. Real
liveness detection needs a face-landmark model. Under Capacitor this is
*harder* than it was under React Native, since it would need a native plugin
or a WASM model in the WebView. Not attempted; call it future work in the
report rather than implying the anti-fraud pipeline is complete client-side.

---

## Verification status

- **Static/syntax check (tsc, all `.js`/`.jsx`/`.mjs`):** passed.
- **JSON configs:** valid.
- **`npm run audit:capacitor`:** executed, passes on the current manifest,
  and verified to exit non-zero on deliberately mismatched versions.
- **Informal Node dry-run:** 22/22 on geofence + compression guards, 19/19 on
  the check-in orchestration with injected fakes.
- **Vitest suite (`npm test`): NOT EXECUTED.** No npm registry access in the
  build sandbox (403), so dependencies could not be installed. The five test
  files are written but have never actually run — **run them before trusting
  them.**
- **Device/emulator:** not performed. Camera, GPS, and the mock-location
  plugin cannot be exercised without real hardware.

## Immediate next steps

1. `npm install && npm test` somewhere with registry access.
2. `npx cap add ios android`, apply the `native/` snippets, and smoke-test
   check-in on a real device — approved, wrong PIN, outside geofence,
   airplane mode, and (Android) with a Fake GPS app installed.
3. Get a decision on open issue #1 from Person 3 — it is a hard blocker for
   real-backend integration.
