import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { mobileOk } from '../../responses/mobileResponse';
import { mobileAnomalySchema, mobileCheckinSchema } from '../../validation/mobileSchemas';
import { performCheckin, reportMobileAnomaly } from '../../services/attendanceService';

const router = Router();

// Person 4's own verify rate limit is 12/employee/minute (API.md Limits table)
// — this is Person 3's front-door limiter, intentionally a little looser so a
// legitimate retry-after-network-blip never gets blocked before reaching the
// AI service's own, more precise limiter.
const checkinLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });

router.post(
  '/checkin',
  checkinLimiter,
  requireAuth('mobile'),
  requirePermission('attendance:checkin', 'mobile'),
  validate(mobileCheckinSchema, 'mobile'),
  asyncHandler(async (req, res) => {
    const result = await performCheckin(req.auth!.sub, req.body);
    mobileOk(res, {
      attendance_log_id: result.attendance_log_id,
      status: result.status,
      face_match_score: result.face_match_score,
      reason: result.reason,
      server_timestamp: result.server_timestamp,
    });
  }),
);

router.post(
  '/anomaly',
  requireAuth('mobile'),
  validate(mobileAnomalySchema, 'mobile'),
  asyncHandler(async (req, res) => {
    await reportMobileAnomaly(req.auth!.sub, req.body);
    mobileOk(res, { reported: true });
  }),
);

export default router;
