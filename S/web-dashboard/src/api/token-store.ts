/**
 * In-memory access token store.
 *
 * WHY MEMORY AND NOT localStorage / sessionStorage
 * ------------------------------------------------
 * OWASP guidance for SPAs is unambiguous: any token reachable from JavaScript
 * is exfiltrable by a single XSS payload, and Web Storage is trivially readable
 * (`localStorage.getItem`). Holding the short-lived access token in a module
 * closure means it exists only in the JS heap for the life of the tab — a
 * stolen-storage attack has nothing to read, and it cannot outlive the session.
 *
 * The trade-off is deliberate and must be understood: **a page refresh destroys
 * the access token.** That is not a bug to be worked around by persisting it.
 * It is why the refresh token lives in an HttpOnly, Secure, SameSite=Strict
 * cookie that JavaScript physically cannot touch, and why the app performs a
 * silent refresh on boot (`bootstrapSession` in `src/auth/session.ts`) to trade
 * that cookie for a fresh access token.
 *
 * Division of responsibility:
 *   access token  (15 min) → here, in memory, sent as `Authorization: Bearer`
 *   refresh token (7 days) → HttpOnly cookie, set and read only by Express
 */

let accessToken: string | null = null;

/** Notified whenever the token is set or cleared, so the UI can react. */
type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener(token));
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function onTokenChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Decode the JWT payload WITHOUT verifying it.
 *
 * Verification requires the server's key and is Express's job on every request.
 * This exists only so the client can read a non-authoritative expiry and refresh
 * proactively rather than waiting to be told no. Never make an authorisation
 * decision from this.
 */
export function readTokenExpiry(token: string | null = accessToken): number | null {
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(
      decodeURIComponent(
        atob(segments[1].replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
          .join(''),
      ),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when the token is absent or within `skewMs` of expiring. */
export function isTokenExpiring(skewMs = 30_000): boolean {
  const expiry = readTokenExpiry();
  if (expiry === null) return accessToken === null;
  return Date.now() >= expiry - skewMs;
}
