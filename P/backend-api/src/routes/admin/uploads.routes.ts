import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { adminOk } from '../../responses/adminResponse';
import { adminPresignSchema } from '../../validation/uploadSchemas';
import { presignAdminUpload } from '../../services/uploadService';

const router = Router();

router.post(
  '/presign',
  requireAuth('admin'),
  requirePermission('employee:write'),
  validate(adminPresignSchema, 'admin'),
  asyncHandler(async (req, res) => {
    const { contentType, contentLength } = req.body as { contentType: string; contentLength: number };
    // A reference photo is presigned BEFORE the employee record exists (it's
    // step 1 of onboarding; the resulting URL feeds POST /employees) — there
    // is no employee _id yet to use as Person 4's required user_ref, so the
    // requesting admin's own id is used for this one presign call instead.
    const result = await presignAdminUpload(req.auth!.sub, contentType, contentLength);
    adminOk(res, result);
  }),
);

export default router;
