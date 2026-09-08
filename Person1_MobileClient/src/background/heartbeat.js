/**
 * Capacitor Background Runner heartbeat handler (Item 13, Flawless/Ultra
 * blueprint). Registered via capacitor.config.json's `BackgroundRunner`
 * block ({ label, src: "background/heartbeat.js", event: "heartbeat",
 * repeat: true, interval: 15, autoStart: true }).
 *
 * ===========================================================================
 * A HEADLESS CONTEXT, NOT THE WEBVIEW — read this before editing.
 * ===========================================================================
 * This file runs in its own JS context, entirely separate from the WebView
 * backgroundTelemetry.js runs in. The OS creates a fresh context per
 * triggered event, runs the matching addEventListener handler below, and
 * destroys the context the instant resolve()/reject() is called — there is
 * no persistent state between invocations, no `document`/`window`, and no
 * bundler: this file is NOT processed by Vite (no `import.meta.env`, no npm
 * imports). Only the runner's own documented globals are available:
 * TextDecoder/TextEncoder, console.*, setTimeout/setInterval, fetch (with
 * limited option support), crypto, and the Capacitor*-prefixed helpers
 * (CapacitorKV, CapacitorGeolocation, CapacitorDevice, CapacitorNotifications,
 * CapacitorApp) — no axios, which is why this mirrors backgroundTelemetry.js's
 * body shape using plain fetch() instead of reusing its axios-based http.js.
 *
 * `interval: 15` in the config means **15 minutes**, not the WebView
 * heartbeat's 15 *seconds* — the Background Runner's OS-level scheduler
 * cannot guarantee sub-minute wake cadence on either platform (a real,
 * battery-motivated platform constraint, not a config oversight). This is
 * deliberately a much lower-frequency backstop for when the WebView is not
 * alive at all, not a like-for-like replacement for the foreground interval.
 *
 * ===========================================================================
 * THE SAME UNRESOLVED CREDENTIAL PROBLEM AS PnsmTelemetryUploader.java.
 * ===========================================================================
 * src/lib/http.js deliberately keeps the access token in an in-memory JS
 * variable only, inside the WebView's own JS context — by design, so a
 * short-lived token can never be read back off the device later. That is
 * the right call for the WebView's own requests, and it means this headless
 * context has no way to read that token either: `CapacitorKV.get()` below
 * will always return null under the current architecture, because nothing
 * ever writes a token there. This is not a bug to quietly patch around; it
 * is the same genuine, unresolved boundary PnsmTelemetryUploader.java's own
 * doc comment already names on the Android-native side — closing it (e.g.
 * minting a distinct, narrowly-scoped, independently-revocable
 * background-upload credential at login) is a deliberate team decision, not
 * something this scaffold should invent on its own. The code below performs
 * the read and null-check honestly and does nothing further when it is
 * null, exactly like its Java counterpart.
 */

const API_BASE_URL = "https://REPLACE_ME.example.invalid"; // see PnsmTelemetryUploader.java's identical placeholder
const HEARTBEAT_PATH = "/api/mobile/heartbeat";
const TOKEN_KEY = "pnsm_access_token"; // never actually written today — see the class doc above

async function sendHeartbeatHeadless() {
  const token = await CapacitorKV.get(TOKEN_KEY);
  if (!token || !token.value) {
    console.warn("[heartbeat] no persisted access token available; skipping upload (see file header)");
    return;
  }

  const position = await CapacitorGeolocation.getCurrentPosition({ enableHighAccuracy: true });

  // Field shape matches mobileHeartbeatSchema (Person3_BackendAPI/src/
  // validation/mobileSchemas.ts: {lat, lng, accuracy?, timestamp}) exactly,
  // mirroring backgroundTelemetry.js's own sendHeartbeat() body field-for-field.
  const body = {
    lat: position.latitude,
    lng: position.longitude,
    accuracy: position.accuracy,
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(API_BASE_URL + HEARTBEAT_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.value}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A headless context has no HttpOnly cookie jar to run the WebView's own
    // refresh-token dance against — it cannot recover from a 401 itself,
    // the same limitation PnsmTelemetryUploader.java's Worker documents.
    throw new Error(`heartbeat upload failed with status ${response.status}`);
  }
}

addEventListener("heartbeat", (resolve, reject) => {
  sendHeartbeatHeadless().then(resolve).catch((err) => {
    console.warn("[heartbeat] failed, will retry next scheduled run:", err && err.message);
    // Rejecting (rather than resolving anyway) lets the OS apply its own
    // exponential backoff between retries, the same principle
    // PnsmTelemetryUploader.java's Worker gets from WorkManager's
    // BackoffPolicy.EXPONENTIAL — this file has no equivalent scheduling
    // API of its own to implement backoff with directly.
    reject(err);
  });
});
