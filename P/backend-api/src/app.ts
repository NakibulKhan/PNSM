/**
 * Split from server.ts so tests can drive createApp() through supertest
 * without opening a port or attaching Socket.IO.
 *
 * Express 5 (blueprint mandate). Two consequences worth knowing:
 *  - Rejected promises from route handlers propagate to the error middleware
 *    automatically. asyncHandler is kept anyway: it costs nothing, and it
 *    keeps the intent explicit rather than relying on framework behaviour.
 *  - path-to-regexp v8 fatally rejects unnamed wildcards ('*', '/*'). This
 *    app defines none; if a catch-all is ever needed use '/*splat'.
 */
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { ALLOWED_ORIGINS } from './config/env';
import { createRateLimiter } from './middleware/rateLimiter';
import { incidentBlocklistGuard } from './middleware/incidentBlocklist';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Required for `req.ip`/rate limiting/the incident blocklist to see the
  // REAL client address once traffic can arrive via infra/tls-proxy
  // (Item 8) — nginx sets X-Forwarded-For correctly, but Express ignores
  // that header entirely without this, so every proxied request collapsed
  // onto the proxy container's own IP as far as every IP-keyed system was
  // concerned (one shared rate-limit/incident-blocklist bucket for all
  // traffic through :8443). Scoped to Express's built-in private-network
  // preset — NOT `true` (trust every hop) — because :5000 also still
  // accepts direct, unproxied connections as the primary dev workflow;
  // trusting the header unconditionally would let any direct caller spoof
  // X-Forwarded-For to bypass IP-based rate limiting/blocking outright, and
  // Docker's internal bridge network is always within this private range.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(
    helmet({
      // A JSON API serves no HTML, so the default CSP is inert here — but
      // keeping it set costs nothing and matters if an error page is ever
      // rendered.
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
      frameguard: { action: 'deny' },
    }),
  );

  /**
   * CORS. This is NEW under the blueprint: Person 1's mobile client is now a
   * Capacitor WebView (a browser), not a native Flutter/React-Native HTTP
   * client, so mobile REST calls are now subject to CORS where previously
   * they were not. `credentials: true` is required for the HttpOnly refresh
   * cookie, which in turn forbids a wildcard origin — hence an explicit
   * allowlist.
   */
  app.use(
    cors({
      origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Same-origin/server-to-server requests (Person 2's Next.js proxy,
        // curl, health probes) send no Origin header at all.
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // Created per createApp() call (not module-level) so each test's app gets
  // its own isolated limiter state, same reasoning as every per-route
  // limiter below already being created inside its own route-module scope.
  const globalRateLimiter = createRateLimiter({ keyPrefix: 'global', points: 300, durationSec: 60, blockDurationSec: 60 });

  // Perimeter checks, ahead of any route: an IP already escalated into the
  // IncidentBlocklist (Item 3c) is rejected before it reaches routing at all,
  // then a coarse app-wide floor (Item 1) catches genuinely abusive traffic
  // that no single per-route limiter was tuned to expect. Per-route limiters
  // (auth/attendance/heartbeat) still apply on top of this — this is a floor,
  // not a replacement for their tighter, endpoint-specific budgets.
  app.use(incidentBlocklistGuard);
  app.use(globalRateLimiter);

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
