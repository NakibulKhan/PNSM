/**
 * Session lifecycle against the dual-token scheme.
 *
 * THE BOOT PROBLEM
 * ----------------
 * The access token lives in memory, so a page refresh — or opening a bookmarked
 * deep link in a new tab — starts with no token at all. Without a recovery
 * step, every reload would dump a signed-in administrator back at the login
 * form, which is unusable.
 *
 * `bootstrapSession()` solves it: on startup the app calls /auth/refresh with
 * no body. The browser automatically attaches the HttpOnly refresh cookie
 * (which is why `withCredentials` is mandatory), Express validates it and issues
 * a fresh access token, and the app then loads the profile. If the cookie is
 * missing or expired the call 401s and the user is legitimately signed out.
 */
import { api } from '@/api/client';
import { http, refreshAccessToken } from '@/api/http';
import { clearAccessToken, setAccessToken } from '@/api/token-store';
import { isAdminRole } from '@/lib/rbac';
import type { SessionUser } from '@/types/models';
import type { LoginResponse } from '@/types/api';

export class NotAnAdminError extends Error {
  constructor() {
    super('This console is for HR and Super Admin accounts. Employees use the mobile app.');
    this.name = 'NotAnAdminError';
  }
}

/**
 * Sign in. Express returns the access token in the JSON body and sets the
 * refresh token as an HttpOnly cookie in the same response — the browser stores
 * that cookie itself and JavaScript never sees it.
 */
export async function login(email: string, password: string): Promise<SessionUser> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  if (!isAdminRole(data.user.role)) throw new NotAnAdminError();
  setAccessToken(data.accessToken);
  return data.user;
}

/** Returns the signed-in user, or null when there is no valid refresh cookie. */
export async function bootstrapSession(): Promise<SessionUser | null> {
  try {
    await refreshAccessToken();
  } catch {
    clearAccessToken();
    return null;
  }

  try {
    const { data } = await api.get<SessionUser>('/auth/me');
    return isAdminRole(data.role) ? data : null;
  } catch {
    clearAccessToken();
    return null;
  }
}

/**
 * Sign out. The server call matters: only Express can clear the HttpOnly cookie
 * and revoke the refresh token server-side. Dropping the in-memory token alone
 * would leave a usable refresh cookie behind.
 */
export async function logout(): Promise<void> {
  try {
    await http.post('/auth/logout', {}, { _skipAuthRefresh: true } as never);
  } catch {
    // Network failure must not trap the user in a signed-in shell.
  } finally {
    clearAccessToken();
  }
}
