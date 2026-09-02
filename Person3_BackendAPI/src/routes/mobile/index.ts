import { Router } from 'express';
import { markRouteGroup } from '../../middleware/routeGroup';
import authRoutes from './auth.routes';
import profileRoutes from './profile.routes';
import attendanceRoutes from './attendance.routes';
import heartbeatRoutes from './heartbeat.routes';
import uploadsRoutes from './uploads.routes';

const router = Router();

// Bare-body convention for every route under here (ADR-1) — marked once so
// the central error handler's fallback path is correct even for an error
// thrown before a specific handler's own response helper would have run.
router.use(markRouteGroup('mobile'));

router.use('/auth', authRoutes);
router.use(profileRoutes); // GET /me
router.use('/attendance', attendanceRoutes);
router.use('/heartbeat', heartbeatRoutes);
router.use('/uploads', uploadsRoutes);

export default router;
