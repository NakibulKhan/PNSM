import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { getCurrentPosition } from "./hardware";
import { http, getAccessToken } from "./http";

/**
 * Continuous background telemetry for field agents (Quadrant I).
 *
 * ===========================================================================
 * SCOPE AND HONESTY NOTES — READ BEFORE SHIPPING THIS
 * ===========================================================================
 *
 * 1. WHAT THIS FILE CAN AND CANNOT DO ALONE.
 *    The JS layer inside the WebView is suspended when the OS backgrounds the
 *    app. No amount of JavaScript keeps a timer alive through an Android
 *    Doze/OOM kill or an iOS suspension. Genuine background telemetry
 *    therefore requires NATIVE code that this file only coordinates with:
 *      - Android: a Foreground Service (persistent notification) implemented
 *        in Java/Kotlin. Scaffold provided at native/PnsmForegroundService.java.
 *      - iOS: CLLocationManager configured with
 *        allowsBackgroundLocationUpdates = true and
 *        pausesLocationUpdatesAutomatically = false, plus the UIBackgroundModes
 *        'location' entitlement. See native/ios-Info.plist.snippet.xml.
 *    Until those native pieces are added to the generated ios/ and android/
 *    projects, this module degrades to FOREGROUND-ONLY heartbeats and reports
 *    that honestly via getTelemetryCapability(). It does not pretend to be
 *    tracking when it is not — a silent tracking failure is worse than none,
 *    because HR would trust an attendance record that was never collected.
 *
 * 2. THE 15-SECOND HEARTBEAT IS EXPENSIVE.
 *    The blueprint specifies a 15s interval. At high-accuracy GNSS that is a
 *    material battery drain over an 8-hour shift and will generate ~1,920
 *    writes per employee per day into AttendanceLogs-adjacent storage. The
 *    interval is therefore configurable here, and the default is deliberately
 *    surfaced to the team as a tuning decision rather than buried.
 *
 * 3. LEGAL / PRIVACY OBLIGATION — NOT OPTIONAL, NOT MY CALL TO WAIVE.
 *    Continuous location tracking of employees is regulated in most
 *    jurisdictions and both app stores treat it as a high-scrutiny capability:
 *      - Apple requires a clear justification for UIBackgroundModes:location
 *        and rejects apps whose usage strings are vague.
 *      - Google Play requires a Location Permissions declaration for
 *        background access and demands a documented, user-visible purpose.
 *    Employees must be informed that tracking occurs, when it is active, and
 *    it should not run outside working hours. isWithinTrackingWindow() below
 *    enforces the shift-hours limit in code so this is a property of the
 *    system rather than a promise in a policy document. Person 4 / the
 *    project owners should confirm the consent and disclosure position before
 *    this ships to real employees.
 * ===========================================================================
 */

export const DEFAULT_HEARTBEAT_MS = 15000; // per blueprint
// DECISIONS.md B7 — Person 3's real endpoint, under the mobile route family.
const HEARTBEAT_ENDPOINT = "/api/mobile/heartbeat";

let timerId = null;
let config = null;
let lastSentAt = null;
let consecutiveFailures = 0;

/**
 * Reports what background telemetry is actually achievable on this device
 * right now, so the UI and the project report can state it accurately.
 */
export function getTelemetryCapability() {
  const platform = Capacitor.getPlatform();
  if (platform === "web") {
    return { platform, background: false, reason: "Browser dev build — foreground only." };
  }
  if (platform === "android") {
    return {
      platform,
      background: false,
      reason:
        "Foreground-only until PnsmForegroundService is registered in the native Android project.",
    };
  }
  return {
    platform,
    background: false,
    reason:
      "Foreground-only until UIBackgroundModes:location and CLLocationManager flags are set in the native iOS project.",
  };
}

/**
 * Shift-window guard. Pure and testable.
 * @param {Date} now
 * @param {{startHour:number, endHour:number, days:number[]}} shift
 */
export function isWithinTrackingWindow(now, shift) {
  if (!shift) return false;
  const day = now.getDay();
  if (!shift.days.includes(day)) return false;
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour >= shift.startHour && hour < shift.endHour;
}

/**
 * Exponential backoff so a backend outage doesn't turn into 4 requests/minute
 * per employee hammering a degraded API.
 *
 * The exponent clamp must be high enough that `baseMs * 2^clamp` actually
 * reaches the stated 10-minute ceiling — at 15s base, exponent 5 (32x) tops
 * out at 8 minutes, so the outer Math.min() below could never fire and the
 * documented cap was unreachable. First real test run (never executed
 * before) caught this: `backoffMs(50)` returned 480000, not the intended
 * 600000. Exponent 6 (64x = 16 minutes of multiplier headroom) is the
 * smallest clamp that lets the explicit cap actually apply.
 */
export function backoffMs(failures, baseMs = DEFAULT_HEARTBEAT_MS) {
  if (failures <= 0) return baseMs;
  return Math.min(baseMs * 2 ** Math.min(failures, 6), 10 * 60 * 1000);
}

async function sendHeartbeat() {
  if (!config) return;

  const now = new Date();
  if (!isWithinTrackingWindow(now, config.shift)) return; // outside shift: stay silent
  if (!getAccessToken()) return; // not authenticated: nothing to attribute

  try {
    const pos = await getCurrentPosition({ timeout: 8000 });
    // Fields match Person 3's mobileHeartbeatSchema exactly (PNSM_Khan_Edit)
    // — identity comes from the bearer token, not an employee_id field, and
    // there is no `kind` field: the endpoint itself (/api/mobile/heartbeat,
    // never /attendance/*) is what keeps this from ever being interpreted as
    // a check-in.
    await http.post(HEARTBEAT_ENDPOINT, {
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      timestamp: new Date().toISOString(),
    });
    lastSentAt = now;
    consecutiveFailures = 0;
  } catch {
    consecutiveFailures += 1;
  } finally {
    schedule();
  }
}

function schedule() {
  if (!config) return;
  clearTimeout(timerId);
  timerId = setTimeout(sendHeartbeat, backoffMs(consecutiveFailures, config.intervalMs));
}

/**
 * @param {{employeeId:string, shift:{startHour:number,endHour:number,days:number[]},
 *          intervalMs?:number}} options
 */
export function startTelemetry(options) {
  stopTelemetry();
  config = { intervalMs: DEFAULT_HEARTBEAT_MS, ...options };
  consecutiveFailures = 0;
  schedule();

  // When the app returns to the foreground, fire immediately rather than
  // waiting out the remaining interval — the OS may have frozen the timer.
  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive && config) {
      clearTimeout(timerId);
      sendHeartbeat();
    }
  }).catch(() => {
    /* listener unavailable on web */
  });
}

export function stopTelemetry() {
  clearTimeout(timerId);
  timerId = null;
  config = null;
  consecutiveFailures = 0;
}

export function getTelemetryStatus() {
  return {
    running: timerId !== null,
    lastSentAt,
    consecutiveFailures,
    intervalMs: config?.intervalMs ?? DEFAULT_HEARTBEAT_MS,
  };
}

/**
 * Android OEM battery-optimisation whitelist prompt.
 *
 * Xiaomi/Huawei/Samsung ROMs aggressively kill backgrounded apps regardless
 * of a Foreground Service. The blueprint calls for detecting this and prompting
 * the user to whitelist the app, referencing dontkillmyapp.com.
 *
 * NOT IMPLEMENTED HERE, deliberately: there is no Capacitor-official API for
 * this, and the correct implementation is a native intent
 * (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) — which Google Play restricts
 * to apps whose core function genuinely requires it and which must be
 * justified in the Play Console listing. Wiring an unjustified version of this
 * is a real store-rejection risk, so it needs a deliberate team decision
 * rather than a quiet implementation. Returns guidance for now.
 */
export function getBatteryOptimizationGuidance() {
  const platform = Capacitor.getPlatform();
  if (platform !== "android") return null;
  return {
    needed: true,
    guidanceUrl: "https://dontkillmyapp.com",
    note:
      "Requires a native ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS intent plus a Play Console justification. Team decision pending.",
  };
}
