import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { mobileLoginSchema, mobileRefreshSchema } from '../../validation/mobileSchemas';
import * as mobileAuthService from '../../services/mobileAuthService';
import { mobileOk } from '../../responses/mobileResponse';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../../utils/jwt';
import { IS_PRODUCTION } from '../../config/env';
import { MobileApiError } from '../../utils/errors';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

router.post(
  '/login',
  loginLimiter,
  validate(mobileLoginSchema, 'mobile'),
  asyncHandler(async (req, res) => {
    const { employee_code, password } = req.body as { employee_code: string; password: string };
    const result = await mobileAuthService.mobileLogin(employee_code, password);

    // DECISIONS.md B1/N3 — "issue both": cookie for any context that can use
    // it, body for Capacitor WebViews where cookies are unreliable.
    res.cookie(REFRESH_COOKIE_NAME, result.refresh_token, refreshCookieOptions(IS_PRODUCTION));
    mobileOk(res, { access_token: result.access_token, refresh_token: result.refresh_token, user: result.user });
  }),
);

router.post(
  '/refresh',
  refreshLimiter,
  validate(mobileRefreshSchema, 'mobile'),
  asyncHandler(async (req, res) => {
    const fromCookie = (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? undefined;
    const fromBody = (req.body as { refresh_token?: string } | undefined)?.refresh_token;
    const token = fromCookie ?? fromBody;
    if (!token) {
      throw new MobileApiError(401, 'unauthenticated');
    }

    const result = await mobileAuthService.mobileRefresh(token);
    res.cookie(REFRESH_COOKIE_NAME, result.refresh_token, refreshCookieOptions(IS_PRODUCTION));
    mobileOk(res, { access_token: result.access_token, refresh_token: result.refresh_token });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(IS_PRODUCTION));
    mobileOk(res, { ok: true });
  }),
);

export default router;
