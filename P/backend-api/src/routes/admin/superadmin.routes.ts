import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { updatePolicySchema } from '../../validation/policySchemas';
import * as superAdminService from '../../services/superAdminService';
import { listIncidents } from '../../services/incidentService';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/admins',
  requirePermission('admin:manage'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await superAdminService.listAdmins());
  }),
);

router.get(
  '/audit',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const result = await superAdminService.listAuditLog();
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.get(
  '/spoof-alerts',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const result = await superAdminService.listSpoofAlerts();
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.get(
  '/admins/incidents',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const result = await listIncidents();
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.get(
  '/billing',
  requirePermission('billing:read'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await superAdminService.getBilling());
  }),
);

router.get(
  '/policy',
  requirePermission('settings:read'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await superAdminService.getPolicy());
  }),
);

router.patch(
  '/policy',
  requirePermission('policy:write'),
  validate(updatePolicySchema, 'admin'),
  asyncHandler(async (req, res) => {
    adminOk(res, await superAdminService.updatePolicy(req.body));
  }),
);

export default router;
