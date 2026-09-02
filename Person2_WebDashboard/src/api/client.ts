/**
 * Typed data-access helpers over the Axios instance.
 *
 * Every response from Person 3 is wrapped in `{ data, error, meta }`; these
 * helpers unwrap it and normalise failures into a single `ApiError` the UI can
 * render, so no component ever handles an AxiosError directly.
 */
import { AxiosError } from 'axios';
import { http } from './http';
import type { ApiEnvelope, ApiMeta } from '@/types/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/** Strip empty values so the query string stays clean and cache keys stay stable. */
function cleanParams(params?: QueryParams): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') out[key] = String(value);
  });
  return out;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof AxiosError) {
    const envelope = error.response?.data as ApiEnvelope<unknown> | undefined;

    if (error.code === 'ECONNABORTED') {
      return new ApiError(
        504,
        'BACKEND_TIMEOUT',
        'The server did not respond in time. If it was idle it may still be starting up.',
      );
    }
    if (!error.response) {
      return new ApiError(
        0,
        'NETWORK_UNREACHABLE',
        'Cannot reach the server. Check your connection, or that the API is running.',
      );
    }
    return new ApiError(
      error.response.status,
      envelope?.error?.code ?? 'REQUEST_FAILED',
      envelope?.error?.message ?? 'That request did not complete. Try again.',
      envelope?.error?.details,
    );
  }

  return new ApiError(0, 'UNKNOWN', 'Something went wrong. Try again.');
}

async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<{ data: T; meta?: ApiMeta }> {
  try {
    const response = await promise;
    const envelope = response.data;
    if (!envelope || envelope.error) {
      throw new ApiError(
        200,
        envelope?.error?.code ?? 'MALFORMED_RESPONSE',
        envelope?.error?.message ?? 'The server returned an unexpected response.',
      );
    }
    return { data: envelope.data, meta: envelope.meta };
  } catch (error) {
    throw toApiError(error);
  }
}

export const api = {
  get: <T,>(path: string, params?: QueryParams) =>
    unwrap<T>(http.get<ApiEnvelope<T>>(path, { params: cleanParams(params) })),

  post: <T,>(path: string, body?: unknown, params?: QueryParams) =>
    unwrap<T>(http.post<ApiEnvelope<T>>(path, body ?? {}, { params: cleanParams(params) })),

  patch: <T,>(path: string, body?: unknown) =>
    unwrap<T>(http.patch<ApiEnvelope<T>>(path, body ?? {})),

  delete: <T,>(path: string) => unwrap<T>(http.delete<ApiEnvelope<T>>(path)),
};

/** Convenience for the common case where only `data` is needed. */
export async function fetchData<T>(path: string, params?: QueryParams): Promise<T> {
  const { data } = await api.get<T>(path, params);
  return data;
}
