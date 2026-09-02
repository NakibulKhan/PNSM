import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import {
  createEmployeeSchema,
  listEmployeesQuerySchema,
  updateEmployeePhotoSchema,
  updateEmployeeSchema,
} from '../../validation/employeeSchemas';
import * as employeeService from '../../services/employeeService';
import type { ListEmployeesQuery } from '../../validation/employeeSchemas';
import { stringParam } from '../../utils/params';

const router = Router();

router.use(requireAuth('admin'));

router.get(
  '/',
  requirePermission('employee:read'),
  validate(listEmployeesQuerySchema, 'admin', 'query'),
  asyncHandler(async (req, res) => {
    const result = await employeeService.listEmployees(req.query as unknown as ListEmployeesQuery);
    adminOk(res, result.rows, { page: result.page, pageSize: result.pageSize, total: result.total });
  }),
);

router.get(
  '/:id',
  requirePermission('employee:read'),
  asyncHandler(async (req, res) => {
    const employee = await employeeService.getEmployee(stringParam(req, 'id'));
    adminOk(res, employee);
  }),
);

router.post(
  '/',
  requirePermission('employee:write'),
  validate(createEmployeeSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const result = await employeeService.createEmployee(req.body);
    adminOk(res, result, undefined, 201);
  }),
);

router.patch(
  '/:id',
  requirePermission('employee:write'),
  validate(updateEmployeeSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const employee = await employeeService.updateEmployee(stringParam(req, 'id'), req.body);
    adminOk(res, employee);
  }),
);

router.patch(
  '/:id/photo',
  requirePermission('employee:write'),
  validate(updateEmployeePhotoSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const employee = await employeeService.updateEmployeePhoto(stringParam(req, 'id'), req.body.reference_photo_url);
    adminOk(res, employee);
  }),
);

router.delete(
  '/:id',
  requirePermission('employee:deactivate'),
  asyncHandler(async (req, res) => {
    await employeeService.deactivateEmployee(stringParam(req, 'id'));
    adminOk(res, { ok: true });
  }),
);

export default router;
