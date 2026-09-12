import { Router } from 'express';
import { createRateLimiter } from '../../middleware/rateLimiter';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { mobileOk } from '../../responses/mobileResponse';
import { mobileHeartbeatSchema } from '../../validation/mobileSchemas';
import { recordHeartbeat } from '../../services/heartbeatService';

const router = Router();

/**
 * DECISIONS.md B7 — by far the highest-volume mobile route (a 15s client
 * interval), so it gets its own generous-but-real rate-limit budget rather
 * than sharing one with lower-frequency routes. 6/minute per device would be
 * too tight for a 15s interval with any jitter; this allows roughly double
 * the expected rate before pushing back.
 */
const heartbeatLimiter = createRateLimiter({ keyPrefix: 'mobile-heartbeat', points: 10, durationSec: 60, blockDurationSec: 120 });

router.post(
  '/',
  heartbeatLimiter,
  requireAuth('mobile'),
  validate(mobileHeartbeatSchema, 'mobile'),
  asyncHandler(async (req, res) => {
    await recordHeartbeat(req.auth!.sub, req.body);
    mobileOk(res, { ok: true });
  }),
);

export default router;
