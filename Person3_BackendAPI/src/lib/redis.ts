/**
 * Single shared ioredis client for distributed rate limiting (Item 1) and the
 * incident blocklist (Item 3c). `lazyConnect: true` means the TCP connection
 * only opens on first real command, not at import time — createApp() runs
 * synchronously in every test (see tests/integration/health.test.ts's own
 * comment: "No live DB connection in this test run"), so this file must never
 * throw or hang just from being imported.
 */
import Redis from 'ioredis';
import { REDIS_URL, IS_TEST } from '../config/env';

let client: Redis | null = null;

/** Returns the shared client, or null under IS_TEST (callers fall back to an in-memory store). */
export function getRedis(): Redis | null {
  if (IS_TEST) return null;
  if (!client) {
    client = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    client.on('error', (err) => {
      // rate-limiter-flexible's RateLimiterRedis already degrades a failed
      // Redis call to a caught rejection at the call site; this listener only
      // exists so ioredis's own unhandled 'error' event never crashes the
      // process (its documented default behavior with no listener attached).
      // eslint-disable-next-line no-console
      console.warn('[redis] connection error', err.message);
    });
  }
  return client;
}
