import axios from "axios";

/**
 * Axios interceptor layer for the Custom JWT dual-token architecture
 * (Quadrant III's "Network Token Desynchronization" obstacle).
 *
 * Design per the blueprint:
 *  - Access token (15 min): held in transient memory ONLY. Never written to
 *    localStorage or Capacitor Preferences — persisted storage in a WebView
 *    is readable by injected script and defeats the point of the short TTL.
 *  - Refresh token (7 days): lives in an HttpOnly; Secure; SameSite cookie
 *    set by the server. JS cannot read it by design, so we never touch it —
 *    we just need withCredentials so the WebView attaches it to /refresh.
 *  - On 401: pause, hit /refresh once, replay the original request.
 */

export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:5000";

/* ------------------------------------------------- in-memory token store */

let accessToken = null;
let onSessionExpired = null;

export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
export function clearAccessToken() {
  accessToken = null;
}
/** Registers the callback that boots the user back to Login when refresh fails. */
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

/* --------------------------------------------------------- axios instance */

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  // Required for the HttpOnly refresh cookie to ride along to /refresh.
  withCredentials: true,
});

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/* ------------------------------------------- single-flight refresh + queue */

// Without this, N concurrent requests that all 401 would fire N parallel
// refreshes and rotate the refresh token N times — with token rotation
// enabled server-side, all but one of those rotations is invalidated and the
// user gets logged out spuriously. So: one refresh in flight, everyone else
// queues on it.
let refreshInFlight = null;
const waiters = [];

function subscribeToRefresh() {
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

function flushWaiters(error, token) {
  while (waiters.length) {
    const { resolve, reject } = waiters.shift();
    if (error) reject(error);
    else resolve(token);
  }
}

async function performRefresh() {
  // Deliberately a bare axios call, not `http` — using the instance would
  // re-enter this same interceptor and recurse if /refresh itself 401s.
  //
  // /api/mobile/auth/refresh, not /api/auth/refresh — mobile has its own
  // route family with a bare, snake_case response body (PNSM_Khan_Edit's
  // DECISIONS.md N3): the admin path returns the {data,error,meta} envelope
  // and a camelCase accessToken field instead, which is a different, wrong
  // shape here.
  const res = await axios.post(
    `${API_BASE_URL}/api/mobile/auth/refresh`,
    {},
    { withCredentials: true, timeout: 15000 }
  );
  const token = res?.data?.access_token;
  if (!token) throw new Error("Refresh response did not contain an access token");
  return token;
}

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // A 401 from the mobile API means "sign in required" ONLY when
    // `reason === 'unauthenticated'` (requireAuth's own shape, see
    // Person3_BackendAPI/src/middleware/auth.ts#sendUnauthenticated). Every
    // OTHER mobile business-rule rejection ALSO carries a 401 status by the
    // same shared response convention (mobileError, ADR-1) -- pin_mismatch
    // is the one that surfaced this live: a real end-to-end run
    // (ROADMAP.md Phase 5) found that entering one wrong PIN forced a
    // refresh-and-retry that predictably 401'd again with the same
    // pin_mismatch, which the old blanket check treated as "refresh
    // failed" and logged the employee out entirely -- silently burning a
    // second PIN attempt in the process, for a login session that was
    // never actually invalid.
    const reason = error.response?.data?.reason;
    if (status !== 401 || reason !== "unauthenticated" || !original || original._pnsmRetried) {
      return Promise.reject(error);
    }

    // Never try to refresh the refresh call or the login call itself.
    const url = original.url ?? "";
    if (url.includes("/api/mobile/auth/refresh") || url.includes("/api/mobile/auth/login")) {
      return Promise.reject(error);
    }

    original._pnsmRetried = true;

    try {
      let token;
      if (refreshInFlight) {
        token = await subscribeToRefresh();
      } else {
        refreshInFlight = performRefresh();
        try {
          token = await refreshInFlight;
          setAccessToken(token);
          flushWaiters(null, token);
        } catch (refreshErr) {
          flushWaiters(refreshErr, null);
          throw refreshErr;
        } finally {
          refreshInFlight = null;
        }
      }

      original.headers = original.headers ?? {};
      original.headers.Authorization = `Bearer ${token}`;
      return http(original);
    } catch (refreshErr) {
      clearAccessToken();
      onSessionExpired?.();
      return Promise.reject(refreshErr);
    }
  }
);

/** Test seam: resets module state between test cases. */
export function __resetHttpStateForTests() {
  accessToken = null;
  refreshInFlight = null;
  waiters.length = 0;
  onSessionExpired = null;
}
