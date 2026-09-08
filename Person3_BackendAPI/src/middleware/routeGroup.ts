import type { Request, Response, NextFunction } from 'express';

export type RouteGroup = 'mobile' | 'admin';

/**
 * Mounted once per router subtree (e.g. the mobile router, the admin
 * router). Lets the central error handler pick the right envelope for an
 * *unexpected* error (one that wasn't already thrown as a typed
 * MobileApiError/AdminApiError) without having to guess from the URL.
 */
export function markRouteGroup(group: RouteGroup) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.locals.routeGroup = group;
    next();
  };
}

/**
 * Best-effort route group for middleware mounted AHEAD of `app.use(routes)`
 * (the global rate limiter and the incident-blocklist guard, both in
 * app.ts) — `res.locals.routeGroup` is not set yet at that point, since
 * `markRouteGroup` only runs once request handling reaches the mobile/admin
 * sub-router. Falling back to a bare `?? 'admin'` there sent every mobile
 * client the wrong {data,error} envelope shape for a perimeter-level
 * rejection (429/403) instead of the bare {status,reason,face_match_score}
 * shape ADR-1 requires and Person1_MobileClient/src/lib/api.js actually
 * parses. Path-based inference matches the exact prefix `routes/index.ts`
 * uses to mount the two route families.
 */
export function inferRouteGroup(req: Request): RouteGroup {
  return req.path.startsWith('/api/mobile') ? 'mobile' : 'admin';
}
