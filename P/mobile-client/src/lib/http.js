import axios from "axios";

/**
 * Axios interceptor layer for the Custom JWT dual-token architecture
 * (Quadrant III's "Network Token Desynchronization" obstacle).
 *
 * Design per the blueprint:
 *  - Access token (15 min): held in transient memory ONLY. Never written to
 *    localStorage or Capacitor Preferences — persisted storage in a WebView
 *    is readable by injected script and defeats the point of the short TTL.
 *  - Refresh token (7 days): the server issues it BOTH as an HttpOnly cookie
 *    and in the login response body (Person3's "issue both" design, see
 *    DECISIONS.md B1/N3). On mobile the cookie is unusable: the server pins it
 *    to `path=/api/auth` (Person3_BackendAPI/src/utils/jwt.ts), and cookie path
 *    matching is a prefix test, so it is NEVER sent to /api/mobile/auth/refresh.
 *    The body copy is therefore the only working path here — we hold it in the
 *    same transient memory as the access token, under the same rule: never
 *    persisted, cleared on logout, gone when the WebView is killed.
 *  - On 401: pause, hit /refresh once, replay the original request.
 *
 * A real end-to-end audit found this: because this file previously posted an
 * empty body to /refresh and dropped the login response's refresh_token on the
 * floor, neither the cookie branch nor the body branch on the server could ever
 * be satisfied, and EVERY mobile session hard-expired at the 15-minute access
 * token boundary — force-logging out a field employee mid-shift, potentially
 * mid-check-in. It was invisible under VITE_MOCK_BACKEND=true, which
 * short-circuits before any HTTP call.
 */

export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? "http://localhost:5000";

/* ------------------------------------------------- in-memory token store */

let accessToken = null;
let refreshToken = null;
let onSessionExpired = null;

export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}
/**
 * Memory-only, exactly like the access token. The server rotates this on every
 * refresh, so the newest value must replace the old one or the next refresh
 * presents an already-invalidated token.
 */
export function setRefreshToken(token) {
  refreshToken = token ?? null;
}
export function getRefreshToken() {
  return refreshToken;
}
export function clearAccessToken() {
  accessToken = null;
  refreshToken = null;
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
  //
  // The body carries refresh_token because the cookie cannot reach this route
  // (see the header comment: the server pins the cookie to path=/api/auth).
  // withCredentials stays on so that if a deployment ever does widen the cookie
  // path, the server's `fromCookie ?? fromBody` precedence still works.
  const res = await axios.post(
    `${API_BASE_URL}/api/mobile/auth/refresh`,
    refreshToken ? { refresh_token: refreshToken } : {},
    { withCredentials: true, timeout: 15000 }
  );
  const token = res?.data?.access_token;
  if (!token) throw new Error("Refresh response did not contain an access token");
  // Rotation: the server returns a fresh refresh_token each time and invalidates
  // the previous one. Storing it is not optional — miss it and the NEXT refresh
  // presents a dead token.
  if (res?.data?.refresh_token) setRefreshToken(res.data.refresh_token);
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

    // Deliberately two separate steps. Only a failure of the REFRESH itself
    // means "this session is over" — a failure of the replayed request after a
    // successful refresh is just that request failing (a network blip, a 500),
    // and must not log the employee out of an otherwise-valid session. The
    // earlier single-try version wrapped the replay too, so one dropped packet
    // on the retry destroyed a good session.
    let token;
    try {
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
    } catch (refreshErr) {
      clearAccessToken();
      onSessionExpired?.();
      return Promise.reject(refreshErr);
    }

    original.headers = original.headers ?? {};
    original.headers.Authorization = `Bearer ${token}`;
    return http(original);
  }
);

/** Test seam: resets module state between test cases. */
export function __resetHttpStateForTests() {
  accessToken = null;
  refreshToken = null;
  refreshInFlight = null;
  waiters.length = 0;
  onSessionExpired = null;
}
