/**
 * The Axios instance and its interceptor layer.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The access token is deliberately short-lived (15 minutes) and held only in
 * memory. Left alone, that guarantees a mid-session cliff: the token expires,
 * every in-flight request returns 401, and the user is thrown to the login
 * screen while they are halfway through onboarding an employee.
 *
 * The fix is a pair of interceptors:
 *
 *   REQUEST   resolve the current token from memory and inject it as
 *             `Authorization: Bearer …`. Never read it from storage, never
 *             hard-code it into a component.
 *
 *   RESPONSE  watch for 401. On detection, suspend the failed request, call
 *             /auth/refresh (which authenticates using the HttpOnly cookie the
 *             browser sends automatically), store the rotated access token, and
 *             replay the original request. The user sees nothing.
 *
 * THE CONCURRENCY TRAP
 * --------------------
 * A dashboard fires several requests at once — KPIs, trend, feed, sidebar
 * badges. When the token expires they all 401 within the same tick. A naive
 * implementation fires one refresh per failure, and because Person 3 rotates
 * refresh tokens, the second refresh presents a token the first has already
 * invalidated: every parallel request fails and the user is logged out anyway.
 *
 * So refreshes are serialised. The first 401 performs the refresh; every
 * subsequent 401 parks itself in a queue and is replayed once the single
 * refresh resolves. This is the whole reason the module holds state.
 */
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { API_BASE_URL, IS_DEMO } from '@/config/env';
import { clearAccessToken, getAccessToken, setAccessToken } from './token-store';
import { demoAdapter } from '@/mocks/demo-adapter';
import type { ApiEnvelope } from '@/types/api';

/** Marks a config that has already been replayed, so we never loop. */
interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
  _skipAuthRefresh?: boolean;
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 70_000,
  headers: { 'Content-Type': 'application/json' },
  /*
   * REQUIRED for the dual-token scheme. The refresh token lives in an HttpOnly
   * cookie; without `withCredentials` the browser will not attach it on a
   * cross-origin call, and every refresh silently fails with a 401. Person 3
   * must correspondingly set `credentials: true` in their CORS config and list
   * this origin explicitly — a wildcard origin is invalid with credentials.
   */
  withCredentials: true,
});

// In demo mode every request is served in-process. No network, no backend.
if (IS_DEMO) {
  http.defaults.adapter = demoAdapter;
}

// ---------------------------------------------------------------- request ---
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// --------------------------------------------------------------- response ---

/** Callbacks parked while a refresh is in flight. */
type QueueEntry = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

let isRefreshing = false;
let waiters: QueueEntry[] = [];

function drainQueue(error: unknown, token: string | null) {
  waiters.forEach((waiter) => {
    if (token) waiter.resolve(token);
    else waiter.reject(error);
  });
  waiters = [];
}

/** Invoked when refreshing definitively fails, so the app can send the user to /login. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * Exchange the HttpOnly refresh cookie for a new access token.
 *
 * `_skipAuthRefresh` stops the response interceptor from trying to refresh a
 * failed refresh, which would recurse until the stack blew.
 */
export async function refreshAccessToken(): Promise<string> {
  const response = await http.post<ApiEnvelope<{ accessToken: string }>>(
    '/auth/refresh',
    {},
    { _skipAuthRefresh: true } as AxiosRequestConfig,
  );
  const token = response.data?.data?.accessToken;
  if (!token) throw new Error('The refresh endpoint did not return an access token.');
  setAccessToken(token);
  return token;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const config = error.config as RetryableConfig | undefined;
    const status = error.response?.status;

    const cannotRetry =
      !config ||
      status !== 401 ||
      config._retried ||
      config._skipAuthRefresh ||
      // A failed login is a wrong password, not an expired session.
      (config.url ?? '').includes('/auth/login');

    if (cannotRetry) return Promise.reject(error);

    config._retried = true;

    // A refresh is already running: park this request and replay it after.
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        waiters.push({
          resolve: () => resolve(http(config)),
          reject,
        });
      });
    }

    isRefreshing = true;
    try {
      const token = await refreshAccessToken();
      drainQueue(null, token);
      return await http(config);
    } catch (refreshError) {
      drainQueue(refreshError, null);
      clearAccessToken();
      onSessionExpired?.();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

/** Test seam — resets the module's refresh state between cases. */
export function __resetRefreshStateForTests(): void {
  isRefreshing = false;
  waiters = [];
}
