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
