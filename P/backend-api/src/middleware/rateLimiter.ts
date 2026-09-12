/**
 * Distributed rate limiting (Flawless/Ultra blueprint Item 1). Replaces the
 * old per-route in-memory `express-rate-limit` instances — each was its own
 * counter, so it reset on restart and never shared state across horizontally
 * scaled instances. `rate-limiter-flexible`'s RateLimiterRedis gives a real
 * shared sliding-window-log store plus native escalating block durations.
 *
 * Falls back to RateLimiterMemory when getRedis() returns null (IS_TEST —
 * see src/lib/redis.ts), so the Jest suite never needs a real Redis server;
 * the composite-key and JSON-shape behavior are otherwise identical.
 */
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes, type IRateLimiterOptions } from 'rate-limiter-flexible';
import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../lib/redis';
import { inferRouteGroup, type RouteGroup } from './routeGroup';
import { logger } from '../utils/logger';
import { mobileError } from '../responses/mobileResponse';
import { adminError } from '../responses/adminResponse';

export interface CreateRateLimiterOptions {
  /** Also the Redis key prefix — keep it unique per call site. */
  keyPrefix: string;
  points: number;
  durationSec: number;
  /** Defaults to durationSec — how long a key stays blocked once it exceeds `points`. */
  blockDurationSec?: number;
  /**
   * Called every time this limiter actually blocks a request, with a running
   * count of how many times this IP has been blocked by *any* limiter that
   * supplies this hook. Item 3c's incident-response middleware uses it to
   * escalate a repeat offender into the durable IncidentBlocklist.
   */
  onBlocked?: (info: { ip: string; route: string; blockCount: number }) => void;
}

/**
 * How many times each `${ip}:${keyPrefix}` has been genuinely blocked,
 * inside a rolling window. Redis-backed (INCR+EXPIRE) when available, so
 * this is shared across instances and survives a restart — the same
 * property N24's own migration off in-memory `express-rate-limit` exists to
 * guarantee; an in-memory Map here would quietly reintroduce that exact
 * defect one layer up. Falls back to a plain Map only under IS_TEST (no
 * Redis client — see getRedis()), same convention as the limiter itself.
 * The window is fixed independent of any one route's own blockDurationSec:
 * escalation tracking is a separate concern from the block itself.
 */
const ESCALATION_WINDOW_SEC = 60 * 60;
const memoryBlockCounts = new Map<string, number>();

async function incrementBlockCount(ip: string, keyPrefix: string): Promise<number> {
  const key = `escalation:${ip}:${keyPrefix}`;
  const redis = getRedis();
  if (!redis) {
    const count = (memoryBlockCounts.get(key) ?? 0) + 1;
    memoryBlockCounts.set(key, count);
    return count;
  }
  const results = await redis.multi().incr(key).expire(key, ESCALATION_WINDOW_SEC).exec();
  const count = results?.[0]?.[1];
  return typeof count === 'number' ? count : 1;
}

function composeKey(req: Request, routePrefix: string): string {
  const ip = req.ip ?? 'unknown';
  const userId = req.auth?.sub ?? 'anon';
  return `${ip}:${userId}:${routePrefix}`;
}

export function createRateLimiter(opts: CreateRateLimiterOptions) {
  const redis = getRedis();
  const limiterOpts: IRateLimiterOptions = {
    keyPrefix: opts.keyPrefix,
    points: opts.points,
    duration: opts.durationSec,
    blockDuration: opts.blockDurationSec ?? opts.durationSec,
  };
  const limiter = redis
    ? new RateLimiterRedis({ storeClient: redis, ...limiterOpts })
    : new RateLimiterMemory(limiterOpts);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = composeKey(req, opts.keyPrefix);
    try {
      await limiter.consume(key);
      next();
    } catch (rejection) {
      // rate-limiter-flexible rejects with a RateLimiterRes instance ONLY
      // when the key is genuinely out of points/blocked. Any other
      // rejection (a Redis connection error, a command timeout — real under
      // this client's `maxRetriesPerRequest: 2, enableOfflineQueue: false`
      // config, see lib/redis.ts) is an infrastructure failure, not abuse,
      // and must never be treated as one: without this check, a brief Redis
      // outage would auto-escalate every in-flight request straight into
      // the IncidentBlocklist and lock out real users for 24h over a
      // transient hiccup rather than any actual bad behavior.
      if (!(rejection instanceof RateLimiterRes)) {
        logger.error('rate limiter backend error, failing open', rejection, { keyPrefix: opts.keyPrefix });
        next();
        return;
      }

      res.set('Retry-After', String(Math.max(1, Math.ceil(rejection.msBeforeNext / 1000))));

      if (opts.onBlocked) {
        const ip = req.ip ?? 'unknown';
        const blockCount = await incrementBlockCount(ip, opts.keyPrefix);
        opts.onBlocked({ ip, route: opts.keyPrefix, blockCount });
      }

      // Perimeter middlewares (the global limiter in app.ts) run before
      // `markRouteGroup` — res.locals.routeGroup is not set yet at that
      // point. inferRouteGroup() falls back to path-prefix inference so a
      // blocked mobile client still gets ADR-1's bare-body envelope instead
      // of silently defaulting to the admin {data,error} shape.
      const group: RouteGroup = (res.locals.routeGroup as RouteGroup | undefined) ?? inferRouteGroup(req);
      if (group === 'mobile') {
        mobileError(res, 429, 'rate_limited');
        return;
      }
      adminError(res, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    }
  };
}

/** Test-only: clears the in-memory escalation fallback between test cases. */
export function resetBlockCounts(): void {
  memoryBlockCounts.clear();
}
