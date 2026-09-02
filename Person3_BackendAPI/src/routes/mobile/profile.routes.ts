import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { mobileOk } from '../../responses/mobileResponse';
import { getMobileProfile } from '../../services/mobileProfileService';

const router = Router();

router.get(
  '/me',
  requireAuth('mobile'),
  requirePermission('dashboard:self-view', 'mobile'),
  asyncHandler(async (req, res) => {
    const profile = await getMobileProfile(req.auth!.sub);
    mobileOk(res, profile);
  }),
);

export default router;
