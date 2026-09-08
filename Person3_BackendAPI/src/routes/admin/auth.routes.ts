import { Router } from 'express';
import { createRateLimiter } from '../../middleware/rateLimiter';
import { escalateToIncident } from '../../middleware/incidentBlocklist';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { adminOk } from '../../responses/adminResponse';
import { loginSchema } from '../../validation/authSchemas';
import * as authService from '../../services/authService';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../utils/jwt';
import { IS_PRODUCTION } from '../../config/env';
import { AdminApiError } from '../../utils/errors';

const router = Router();

/**
 * Brute-force mitigation on the one route that accepts a password.
 * `onBlocked` feeds Item 3c's local incident-response escalation: an IP that
 * trips this block twice gets written to the durable IncidentBlocklist and
 * rejected at the perimeter on every subsequent request, before it can even
 * reach this route again — the local, no-AWS analog of GuardDuty auto-block.
 */
const loginLimiter = createRateLimiter({
  keyPrefix: 'admin-login',
  points: 20,
  durationSec: 15 * 60,
  blockDurationSec: 30 * 60,
  onBlocked: escalateToIncident,
});

/**
 * Refresh is rate-limited too, more loosely: a stolen refresh token should
 * not be usable for unlimited silent token minting.
 */
const refreshLimiter = createRateLimiter({
  keyPrefix: 'admin-refresh',
  points: 60,
  durationSec: 15 * 60,
  blockDurationSec: 30 * 60,
});

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await authService.login(email, password);

    // Blueprint: refresh token goes in an HttpOnly/Secure/SameSite=Strict
    // cookie so browser JS physically cannot read it (XSS mitigation).
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(IS_PRODUCTION));

    // ...AND is still returned in the body. This is deliberate, not
    // redundancy: Person 2's api-client.ts (read-only) already destructures
    // `refreshToken` from this response, and their Next.js layer calls us
    // server-to-server where a browser cookie jar does not apply. Capacitor
    // WebViews are likewise unreliable with third-party cookies. Removing the
    // body field would break both clients; the cookie is the hardening for
    // browser contexts that can use it.
    adminOk(res, result);
  }),
);

router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    // Accept the refresh token from the HttpOnly cookie first (browser
    // context), falling back to the JSON body (server-to-server and native
    // clients that cannot use cookies).
    const fromCookie = (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? undefined;
    const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const token = fromCookie ?? fromBody;

    if (!token) {
      throw new AdminApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
    }

    const result = await authService.refresh(token);

    if (result.refreshToken) {
      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions(IS_PRODUCTION));
    }
    adminOk(res, result);
  }),
);

router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    // Clearing the cookie is the only server-side state to drop — access
    // tokens are stateless and simply expire. A token denylist would be the
    // next step if immediate revocation is ever required.
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(IS_PRODUCTION));
    adminOk(res, { ok: true });
  }),
);

/** Role-neutral per ADR-4 — validates the token, does not gate on role. */
router.get(
  '/me',
  requireAuth('admin'),
  asyncHandler(async (req, res) => {
    const sessionUser = await authService.getSessionUser(req.auth!.sub);
    adminOk(res, sessionUser);
  }),
);

export default router;
