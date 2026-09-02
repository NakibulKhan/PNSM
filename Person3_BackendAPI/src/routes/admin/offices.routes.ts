import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { listOffices } from '../../services/officeGeofenceService';

const router = Router();

router.get(
  '/',
  requireAuth('admin'),
  requirePermission('geofence:read'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await listOffices());
  }),
);

export default router;
