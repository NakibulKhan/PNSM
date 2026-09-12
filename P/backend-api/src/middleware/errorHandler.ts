import type { NextFunction, Request, Response } from 'express';
import { MobileApiError, AdminApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { RouteGroup } from './routeGroup';

/** Narrow check for the shape express.json()/body-parser attaches to a malformed-body error. */
function getClientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const status = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/**
 * Single place every unhandled error in the app passes through. Formats
 * MobileApiError / AdminApiError exactly (ADR-1); for anything else
 * (programmer errors, unexpected exceptions), falls back to whichever
 * envelope `markRouteGroup` recorded for this route subtree, defaulting to
 * the admin envelope if that was never set (safer default: it never omits
 * required fields the way a bare 500 text response would for an admin
 * caller expecting {data,error}).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof MobileApiError) {
    // Same 4xx-vs-5xx distinction as mobileResponse.ts's mobileError() —
    // duplicated here (rather than calling that function) because this
    // branch only has the typed error object, not a `reason` string
    // decided at the throw site; kept consistent deliberately.
    const outcome = err.statusCode >= 500 ? 'error' : 'rejected';
    res.status(err.statusCode).json({ status: outcome, reason: err.reason, face_match_score: null, ...(err.extra ?? {}) });
    return;
  }
  if (err instanceof AdminApiError) {
    res.status(err.statusCode).json({
      data: null,
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }

  const group: RouteGroup = (res.locals.routeGroup as RouteGroup | undefined) ?? 'admin';

  // A malformed request body (e.g. invalid JSON — express.json() throws an
  // error with a 4xx `status`/`statusCode` rather than a typed
  // Mobile/AdminApiError) is a client mistake, not a server fault. Without
  // this check it would fall into the generic branch below and incorrectly
  // report 500 for what's actually a 400.
  const clientStatus = getClientErrorStatus(err);
  if (clientStatus !== null) {
    if (group === 'mobile') {
      res.status(clientStatus).json({ status: 'rejected', reason: 'invalid_request', face_match_score: null });
      return;
    }
    res.status(clientStatus).json({ data: null, error: { code: 'BAD_REQUEST', message: 'The request could not be understood.' } });
    return;
  }

  logger.error('Unhandled error', err, { path: req.path, method: req.method });

  if (group === 'mobile') {
    res.status(500).json({ status: 'error', reason: 'server_error', face_match_score: null });
    return;
  }
  res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end. Please try again shortly.' } });
}

export function notFoundHandler(req: Request, res: Response): void {
  const group: RouteGroup = (res.locals.routeGroup as RouteGroup | undefined) ?? 'admin';
  if (group === 'mobile') {
    res.status(404).json({ status: 'error', reason: 'invalid_request', face_match_score: null });
    return;
  }
  res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}.` } });
}
