/**
 * AXIOS INTERCEPTOR / TOKEN-REFRESH SUITE
 *
 * This covers the highest-risk code in the application. The access token lives
 * in memory and expires after 15 minutes, so the refresh-and-replay path runs
 * constantly in real use — and when it goes wrong the symptom is an
 * administrator being thrown to the login screen mid-task, which is exactly the
 * failure the design exists to prevent.
 *
 * The concurrency case is the one that bites: a dashboard fires several requests
 * at once, they all 401 in the same tick, and a naive implementation issues one
 * refresh per failure. Because Person 3 rotates refresh tokens, the second
 * refresh presents a token the first already invalidated and everything fails.
 * These tests pin the serialisation that prevents it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AxiosError, AxiosHeaders } from 'axios';

vi.mock('@/config/env', async () => ({
  IS_DEMO: false,
  API_BASE_URL: 'https://api.test/api',
  SOCKET_URL: 'https://api.test',
  MAPBOX_TOKEN: '',
  MAP_TILE_URL: '',
  MAP_ATTRIBUTION: '',
  APP_VERSION: 'test',
  BUILD_MODE: 'test',
}));

const { http, refreshAccessToken, __resetRefreshStateForTests, setSessionExpiredHandler } =
  await import('@/api/http');
const { getAccessToken, setAccessToken, clearAccessToken, readTokenExpiry, isTokenExpiring } =
  await import('@/api/token-store');

/** Build a structurally valid unsigned JWT with a controllable expiry. */
function makeToken(expiresInSeconds: number, subject = 'user-1'): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({ sub: subject, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
    'sig',
  ].join('.');
}

function ok(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config,
    request: null,
  };
}

function unauthorised(config: InternalAxiosRequestConfig): AxiosError {
  const response: AxiosResponse = {
    data: { data: null, error: { code: 'TOKEN_EXPIRED', message: 'Expired.' } },
    status: 401,
    statusText: 'Unauthorized',
    headers: new AxiosHeaders(),
    config,
    request: null,
  };
  return new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, null, response);
}

let adapter: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetRefreshStateForTests();
  clearAccessToken();
  setSessionExpiredHandler(null);
  adapter = vi.fn();
  http.defaults.adapter = adapter as unknown as AxiosAdapter;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('request interceptor', () => {
  it('attaches the in-memory access token as a Bearer header', async () => {
    setAccessToken('token-abc');
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => Promise.resolve(ok(config, {})));

    await http.get('/employees');

    const sent = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(sent.headers.Authorization).toBe('Bearer token-abc');
  });

  it('sends no Authorization header when signed out', async () => {
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => Promise.resolve(ok(config, {})));

    await http.get('/auth/refresh');

    const sent = adapter.mock.calls[0][0] as InternalAxiosRequestConfig;
    expect(sent.headers.Authorization).toBeUndefined();
  });

  it('sends credentials so the HttpOnly refresh cookie travels cross-origin', () => {
    expect(http.defaults.withCredentials).toBe(true);
  });
});

describe('401 refresh and replay', () => {
  it('refreshes once, then replays the original request transparently', async () => {
    setAccessToken('stale-token');
    let refreshed = false;

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) {
        refreshed = true;
        return Promise.resolve(ok(config, { data: { accessToken: 'fresh-token' }, error: null }));
      }
      if (!refreshed) return Promise.reject(unauthorised(config));
      return Promise.resolve(ok(config, { data: { rows: [] }, error: null }));
    });

    const response = await http.get('/attendance');

    expect(refreshed).toBe(true);
    expect(getAccessToken()).toBe('fresh-token');
    expect(response.status).toBe(200);
  });

  it('replays with the NEW token, not the expired one', async () => {
    setAccessToken('stale-token');
    let refreshed = false;
    const authHeaders: (string | undefined)[] = [];

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) {
        refreshed = true;
        return Promise.resolve(ok(config, { data: { accessToken: 'fresh-token' }, error: null }));
      }
      authHeaders.push(config.headers.Authorization as string | undefined);
      if (!refreshed) return Promise.reject(unauthorised(config));
      return Promise.resolve(ok(config, { data: {}, error: null }));
    });

    await http.get('/employees');

    expect(authHeaders[0]).toBe('Bearer stale-token');
    expect(authHeaders[1]).toBe('Bearer fresh-token');
  });

  it('issues exactly ONE refresh for several simultaneous 401s', async () => {
    setAccessToken('stale-token');
    let refreshCalls = 0;
    let refreshed = false;

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) {
        refreshCalls += 1;
        return new Promise((resolve) =>
          setTimeout(() => {
            refreshed = true;
            resolve(ok(config, { data: { accessToken: 'fresh-token' }, error: null }));
          }, 20),
        );
      }
      if (!refreshed) return Promise.reject(unauthorised(config));
      return Promise.resolve(ok(config, { data: { url: config.url }, error: null }));
    });

    // Exactly the dashboard's opening burst.
    const responses = await Promise.all([
      http.get('/dashboard/kpis'),
      http.get('/dashboard/trend'),
      http.get('/attendance/feed'),
      http.get('/leave'),
    ]);

    // The whole point: rotating refresh tokens make a second call fatal.
    expect(refreshCalls).toBe(1);
    expect(responses).toHaveLength(4);
    responses.forEach((response) => expect(response.status).toBe(200));
  });

  it('does not retry a second time if the replayed request also 401s', async () => {
    setAccessToken('stale-token');
    let refreshCalls = 0;

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(ok(config, { data: { accessToken: 'fresh-token' }, error: null }));
      }
      return Promise.reject(unauthorised(config));
    });

    await expect(http.get('/employees')).rejects.toBeInstanceOf(AxiosError);
    // One refresh, one replay, then stop — never an infinite loop.
    expect(refreshCalls).toBe(1);
  });

  it('clears the token and notifies the app when the refresh itself fails', async () => {
    setAccessToken('stale-token');
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) return Promise.reject(unauthorised(config));
      return Promise.reject(unauthorised(config));
    });

    await expect(http.get('/employees')).rejects.toBeTruthy();

    expect(getAccessToken()).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('never tries to refresh a failed login — that is a wrong password', async () => {
    let refreshCalls = 0;

    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/auth/refresh')) refreshCalls += 1;
      return Promise.reject(unauthorised(config));
    });

    await expect(http.post('/auth/login', { email: 'a@b.c', password: 'wrong1' })).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
  });

  it('does not attempt to refresh a failing refresh call (no recursion)', async () => {
    let refreshCalls = 0;
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      refreshCalls += 1;
      return Promise.reject(unauthorised(config));
    });

    await expect(refreshAccessToken()).rejects.toBeTruthy();
    expect(refreshCalls).toBe(1);
  });

  it('passes non-401 failures straight through', async () => {
    setAccessToken('token');
    adapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      const response: AxiosResponse = {
        data: { data: null, error: { code: 'SERVER', message: 'Boom.' } },
        status: 500,
        statusText: 'Server Error',
        headers: new AxiosHeaders(),
        config,
        request: null,
      };
      return Promise.reject(
        new AxiosError('Server Error', AxiosError.ERR_BAD_RESPONSE, config, null, response),
      );
    });

    await expect(http.get('/employees')).rejects.toMatchObject({ response: { status: 500 } });
  });
});

describe('token store', () => {
  it('keeps the token out of any browser storage', () => {
    setAccessToken(makeToken(900));
    // The whole security argument: an XSS payload reading storage finds nothing.
    expect(window.localStorage.getItem('pnsm_at')).toBeNull();
    expect(window.sessionStorage.getItem('pnsm_at')).toBeNull();
    expect(document.cookie).not.toContain(getAccessToken() ?? 'unreachable');
  });

  it('reads the expiry claim without verifying the signature', () => {
    const token = makeToken(900);
    setAccessToken(token);
    const expiry = readTokenExpiry();
    expect(expiry).not.toBeNull();
    expect(expiry! - Date.now()).toBeGreaterThan(800_000);
  });

  it('reports a token near expiry as expiring', () => {
    setAccessToken(makeToken(10));
    expect(isTokenExpiring(30_000)).toBe(true);
  });

  it('treats a malformed token as having no readable expiry', () => {
    setAccessToken('not-a-jwt');
    expect(readTokenExpiry()).toBeNull();
  });

  it('reports no session once cleared', () => {
    setAccessToken(makeToken(900));
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
    expect(isTokenExpiring()).toBe(true);
  });
});
