/**
 * Local, no-AWS analog of GuardDuty (detect) + EventBridge (route) + Lambda
 * (auto-block) — Flawless/Ultra blueprint Item 3c. Two halves:
 *
 *  - `escalateToIncident`: passed as rateLimiter.ts's `onBlocked` hook. Fires
 *    on every escalated block, but only writes the durable record once an IP
 *    has been blocked twice — a single block is normal traffic-shaping noise,
 *    a second one is a real, repeat-offender signal.
 *  - `incidentBlocklistGuard`: mounted globally in app.ts, ahead of routing —
 *    rejects a request from a currently-blocked IP at the perimeter, before
 *    it reaches any route handler, mirroring how a WAF IP-set block works.
 */
import type { Request, Response, NextFunction } from 'express';
import { IncidentBlocklist } from '../models';
import { recordIncident } from '../services/incidentService';
import { dbReadyState } from '../config/db';
import { logger } from '../utils/logger';
import { inferRouteGroup, type RouteGroup } from './routeGroup';
import { mobileError } from '../responses/mobileResponse';
import { adminError } from '../responses/adminResponse';

const ESCALATION_THRESHOLD = 2;

export function escalateToIncident(info: { ip: string; route: string; blockCount: number }): void {
  if (info.blockCount < ESCALATION_THRESHOLD) return;
  // Fire-and-forget: this runs from inside the rate limiter's rejection path
  // and must never throw or delay the 429 response already being sent.
  recordIncident(info.ip, `escalated rate-limit block on ${info.route}`, info.blockCount).catch((err) => {
    logger.error('incident: failed to record escalation', err, { ip: info.ip, route: info.route });
  });
}

export async function incidentBlocklistGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  // No live DB connection (e.g. every Jest run — see tests/integration/
  // health.test.ts's own comment) means there is no blocklist to consult;
  // skip the query outright rather than let a Mongoose call hang until its
  // own server-selection timeout, which would otherwise stall every request
  // in a test run with no live Mongo.
  if (dbReadyState() !== 'connected') {
    next();
    return;
  }
  const ip = req.ip ?? 'unknown';
  try {
    const entry = await IncidentBlocklist.findOne({ ip, expires_at: { $gt: new Date() } }).lean();
    if (!entry) {
      next();
      return;
    }
    // This guard runs ahead of markRouteGroup (see rateLimiter.ts's identical
    // comment) — infer from the path so a blocked mobile client gets its own
    // bare-body envelope instead of silently defaulting to admin's shape.
    const group: RouteGroup = (res.locals.routeGroup as RouteGroup | undefined) ?? inferRouteGroup(req);
    if (group === 'mobile') {
      mobileError(res, 403, 'ip_blocked');
      return;
    }
    adminError(res, 403, 'IP_BLOCKED', 'This address has been temporarily blocked due to repeated abuse.');
  } catch (err) {
    // A DB hiccup here must not become a global outage for every route — log
    // and let the request through; the rate limiters downstream still apply.
    logger.error('incident: blocklist lookup failed, allowing request through', err, { ip });
    next();
  }
}
