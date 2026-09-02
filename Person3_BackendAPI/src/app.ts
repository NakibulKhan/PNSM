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

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

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

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
