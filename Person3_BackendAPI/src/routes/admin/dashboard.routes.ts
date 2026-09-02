import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { dashboardTrendQuerySchema } from '../../validation/attendanceSchemas';
import type { DashboardTrendQuery } from '../../validation/attendanceSchemas';
import { getDashboardKpis, getDashboardTrend } from '../../services/dashboardService';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/kpis',
  requirePermission('dashboard:view'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await getDashboardKpis());
  }),
);

router.get(
  '/trend',
  requirePermission('dashboard:view'),
  validate(dashboardTrendQuerySchema, 'admin', 'query'),
  asyncHandler(async (req, res) => {
    const { days } = req.query as unknown as DashboardTrendQuery;
    adminOk(res, await getDashboardTrend(days));
  }),
);

export default router;
