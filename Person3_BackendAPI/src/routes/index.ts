import { Router } from 'express';
import healthRoutes from './health.routes';
import adminRoutes from './admin';
import mobileRoutes from './mobile';

const router = Router();

router.use(healthRoutes);

// Person 2's API_BASE_URL already ends in /api, and their endpoint table
// omits the prefix for that reason (architecture report §1) — mounting the
// admin group under /api here reproduces that exact path shape.
router.use('/api', adminRoutes);

// Mobile gets its own path family, not /api/auth/* etc. — DECISIONS.md N3
// explains why the two conventions can't share a path.
router.use('/api/mobile', mobileRoutes);

export default router;
