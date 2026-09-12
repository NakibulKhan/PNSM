import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { createGeofenceSchema, updateGeofenceSchema } from '../../validation/geofenceSchemas';
import * as officeGeofenceService from '../../services/officeGeofenceService';
import { stringParam } from '../../utils/params';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/',
  requirePermission('geofence:read'),
  asyncHandler(async (_req, res) => {
    adminOk(res, await officeGeofenceService.listGeofences());
  }),
);

router.post(
  '/',
  requirePermission('geofence:write'),
  validate(createGeofenceSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const geofence = await officeGeofenceService.createGeofence(req.body);
    adminOk(res, geofence, undefined, 201);
  }),
);

router.patch(
  '/:id',
  requirePermission('geofence:write'),
  validate(updateGeofenceSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const geofence = await officeGeofenceService.updateGeofence(stringParam(req, 'id'), req.body);
    adminOk(res, geofence);
  }),
);

router.delete(
  '/:id',
  requirePermission('geofence:write'),
  asyncHandler(async (req, res) => {
    await officeGeofenceService.deleteGeofence(stringParam(req, 'id'));
    adminOk(res, { ok: true });
  }),
);

export default router;
