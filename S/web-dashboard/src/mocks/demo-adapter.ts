/**
 * Axios adapter that serves every request from the in-process mock backend.
 *
 * WHY AN ADAPTER RATHER THAN MSW
 * ------------------------------
 * An Axios adapter is the documented extension point for replacing the
 * transport layer, and it sits *below* the interceptors — so the real
 * `Authorization` header injection, the 401 refresh flow and the error
 * normalisation all execute exactly as they will in production. A service-worker
 * mock would bypass none of that, but it needs a worker file, an install step
 * and a separate Node setup for tests. This is one file with no dependencies.
 *
 * It faithfully reproduces failure semantics too: non-2xx statuses reject with a
 * genuine AxiosError carrying a response, which is what the interceptor
 * inspects. That means the refresh-and-replay path is exercised in demo mode.
 */
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { handleMockRequest } from './mock-api';

/** Simulated round-trip latency, so loading states are visible while developing. */
const LATENCY_MS = 180;

function toPath(url: string, baseURL?: string): string {
  const absolute = /^https?:\/\//i.test(url);
  const target = absolute ? url : `${(baseURL ?? '').replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  try {
    // A base is supplied so relative targets still parse.
    const parsed = new URL(target, 'http://demo.local');
    // Drop the API prefix — the mock router matches on the bare resource path.
    return parsed.pathname.replace(/^\/api\//, '/').replace(/^\/+/, '');
  } catch {
    return url.replace(/^\/+/, '');
  }
}

export const demoAdapter: AxiosAdapter = async (config) => {
  const method = (config.method ?? 'get').toUpperCase();
  const path = toPath(config.url ?? '', config.baseURL);

  const params = new URLSearchParams();
  Object.entries((config.params ?? {}) as Record<string, unknown>).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });

  let body: unknown;
  if (typeof config.data === 'string') {
    try {
      body = JSON.parse(config.data);
    } catch {
      body = config.data;
    }
  } else {
    body = config.data;
  }

  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  const result = handleMockRequest(method, path, params, body);

  const response: AxiosResponse = {
    data: result.body,
    status: result.status,
    statusText: result.status >= 400 ? 'Error' : 'OK',
    headers: new AxiosHeaders({ 'content-type': 'application/json' }),
    config,
    request: null,
  };

  if (result.status >= 200 && result.status < 300) return response;

  throw new AxiosError(
    `Request failed with status code ${result.status}`,
    result.status === 404 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
    config,
    null,
    response,
  );
};
