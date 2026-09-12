import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, InvalidTokenError } from '../utils/jwt';

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * Populates req.auth = { sub, role } from a valid access token. Role-neutral
 * by design (ADR-6 / ADR-4) — it does not reject any role at this layer.
 * Route-level RBAC (src/middleware/rbac.ts) decides what a given role may do.
 *
 * Takes an explicit response-convention `group`, same pattern as
 * src/middleware/validate.ts (ADR-1) — every current call site is an admin
 * route, so the default preserves that exact behavior. This exists so a
 * future mobile route (Phase 2, pending the flagged MOBILE AUTH CONTRACT
 * REQUIRED dependency — see ADR-6) can call `requireAuth('mobile')` and get
 * a correctly-shaped bare-body 401 without this file needing to change
 * again.
 */
export function requireAuth(group: 'mobile' | 'admin' = 'admin') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req);
    if (!token) {
      sendUnauthenticated(res, group, 'Sign in required.');
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      req.auth = { sub: claims.sub, role: claims.role };
      next();
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        sendUnauthenticated(res, group, 'Session expired. Please sign in again.');
        return;
      }
      next(err);
    }
  };
}

function sendUnauthenticated(res: Response, group: 'mobile' | 'admin', message: string): void {
  if (group === 'mobile') {
    res.status(401).json({ status: 'rejected', reason: 'unauthenticated', face_match_score: null });
    return;
  }
  res.status(401).json({ data: null, error: { code: 'UNAUTHENTICATED', message } });
}
