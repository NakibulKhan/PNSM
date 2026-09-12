/**
 * `isBackendWaking()` is the one check every BACKEND_TIMEOUT/WakingState call
 * site relies on (present-now-tile, kpi-chips, live-feed-tile,
 * employee-detail) — a regression here would silently break the "cold
 * free-tier backend reads as waiting, not failing" UX everywhere at once.
 */
import { describe, it, expect } from 'vitest';
import { ApiError, isBackendWaking } from '@/api/client';

describe('isBackendWaking', () => {
  it('is true for an ApiError carrying the BACKEND_TIMEOUT code', () => {
    const error = new ApiError(504, 'BACKEND_TIMEOUT', 'The server did not respond in time.');
    expect(isBackendWaking(error)).toBe(true);
  });

  it('is false for any other ApiError code, even a 5xx', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    expect(isBackendWaking(error)).toBe(false);
  });

  it('is false for a network-unreachable ApiError (a different, real failure)', () => {
    const error = new ApiError(0, 'NETWORK_UNREACHABLE', 'Cannot reach the server.');
    expect(isBackendWaking(error)).toBe(false);
  });

  it('is false for a non-ApiError value', () => {
    expect(isBackendWaking(new Error('plain error'))).toBe(false);
    expect(isBackendWaking(null)).toBe(false);
    expect(isBackendWaking(undefined)).toBe(false);
    expect(isBackendWaking('BACKEND_TIMEOUT')).toBe(false);
  });
});
