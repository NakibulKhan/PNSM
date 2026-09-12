import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { attendanceFeedQuerySchema, listAttendanceQuerySchema } from '../../validation/attendanceSchemas';
import type { AttendanceFeedQuery, ListAttendanceQuery } from '../../validation/attendanceSchemas';
import * as attendanceService from '../../services/attendanceService';
import { presignSelfieView } from '../../services/uploadService';
import { AttendanceLog } from '../../models';
import { stringParam } from '../../utils/params';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/',
  requirePermission('attendance:read'),
  validate(listAttendanceQuerySchema, 'admin', 'query'),
  asyncHandler(async (req, res) => {
    const result = await attendanceService.listAttendance(req.query as unknown as ListAttendanceQuery);
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.get(
  '/feed',
  requirePermission('attendance:read'),
  validate(attendanceFeedQuerySchema, 'admin', 'query'),
  asyncHandler(async (req, res) => {
    adminOk(res, await attendanceService.getFeed(req.query as unknown as AttendanceFeedQuery));
  }),
);

router.get(
  '/live-map',
  requirePermission('livemap:view'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await attendanceService.getLiveMap());
  }),
);

/** Person4_AIBiometricService/docs/INTEGRATION.md §4.3 — a short-lived read URL, never a permanent public one. */
router.get(
  '/:id/selfie-url',
  requirePermission('attendance:review'),
  asyncHandler(async (req, res) => {
    const log = await AttendanceLog.findById(stringParam(req, 'id')).select('selfie_url').lean();
    if (!log?.selfie_url) {
      adminOk(res, { url: null });
      return;
    }
    // Normalised to the same { url } shape as the no-selfie branch above —
    // presignGet's PresignGetResult carries the URL as `download_url`, and
    // returning that object as-is would have made this endpoint's one caller
    // handle two different field names depending on which branch ran (M2).
    const presigned = await presignSelfieView(log.selfie_url);
    adminOk(res, { url: presigned.download_url ?? null });
  }),
);

router.post(
  '/:id/approve',
  requirePermission('attendance:review'),
  asyncHandler(async (req, res) => {
    adminOk(res, await attendanceService.approveAttendance(stringParam(req, 'id')));
  }),
);

router.post(
  '/:id/reject',
  requirePermission('attendance:review'),
  asyncHandler(async (req, res) => {
    adminOk(res, await attendanceService.rejectAttendance(stringParam(req, 'id')));
  }),
);

export default router;
