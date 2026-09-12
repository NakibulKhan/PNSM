import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { listLeaveQuerySchema } from '../../validation/leaveSchemas';
import type { ListLeaveQuery } from '../../validation/leaveSchemas';
import * as leaveService from '../../services/leaveService';
import { stringParam } from '../../utils/params';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/',
  requirePermission('leave:read'),
  validate(listLeaveQuerySchema, 'admin', 'query'),
  asyncHandler(async (req, res) => {
    const result = await leaveService.listLeaveRequests(req.query as unknown as ListLeaveQuery);
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.post(
  '/:id/approve',
  requirePermission('leave:write'),
  asyncHandler(async (req, res) => {
    adminOk(res, await leaveService.approveLeaveRequest(stringParam(req, 'id')));
  }),
);

router.post(
  '/:id/reject',
  requirePermission('leave:write'),
  asyncHandler(async (req, res) => {
    adminOk(res, await leaveService.rejectLeaveRequest(stringParam(req, 'id')));
  }),
);

export default router;
