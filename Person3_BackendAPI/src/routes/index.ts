import { Router } from 'express';
import healthRoutes from './health.routes';
import adminRoutes from './admin';

const router = Router();

router.use(healthRoutes);

// Person 2's API_BASE_URL already ends in /api, and their endpoint table
// omits the prefix for that reason (architecture report §1) — mounting the
// admin group under /api here reproduces that exact path shape.
router.use('/api', adminRoutes);

// Mobile routes (/api/attendance/checkin, /api/employees/:id/dashboard,
// /api/employees/:id/attendance, /api/leave-requests) are NOT part of this
// phase — Phase 1 is foundation + auth + health only, per the implementation
// plan. They arrive in the phase that builds the attendance pipeline.

export default router;
