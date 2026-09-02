import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { mobileOk } from '../../responses/mobileResponse';
import { mobilePresignSchema } from '../../validation/mobileSchemas';
import { presignMobileUpload } from '../../services/uploadService';

const router = Router();

/** DECISIONS.md N2 — the selfie never touches this server, only the presign request does. */
router.post(
  '/presign',
  requireAuth('mobile'),
  validate(mobilePresignSchema, 'mobile'),
  asyncHandler(async (req, res) => {
    const { purpose, content_type, content_length } = req.body as {
      purpose: 'checkin' | 'reference';
      content_type: string;
      content_length: number;
    };
    const result = await presignMobileUpload(req.auth!.sub, purpose, content_type, content_length);
    mobileOk(res, {
      upload_url: result.upload_url,
      method: result.method,
      headers: result.headers,
      object_key: result.object_key,
      expires_at: result.expires_at,
      max_bytes: result.max_bytes,
    });
  }),
);

export default router;
