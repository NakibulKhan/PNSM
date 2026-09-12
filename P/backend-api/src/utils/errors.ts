/**
 * Two error shapes, matching the two response conventions locked in ADR-1.
 * Throw these from anywhere in a route handler / service call; the central
 * error middleware (src/middleware/errorHandler.ts) formats whichever one it
 * receives and never conflates the two.
 */

/** Mobile-route error — HTTP status + a `reason` enum (api-contract.md). */
export class MobileApiError extends Error {
  constructor(
    public statusCode: number,
    public reason: string,
    public extra?: Record<string, unknown>,
  ) {
    super(reason);
    this.name = 'MobileApiError';
  }
}

/** Admin-route error — HTTP status + { code, message, details? } (01-API-CONTRACT.md). */
export class AdminApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}
