import { Router } from 'express';
import { markRouteGroup } from '../../middleware/routeGroup';
import authRoutes from './auth.routes';
import employeesRoutes from './employees.routes';
import officesRoutes from './offices.routes';
import geofencesRoutes from './geofences.routes';
import uploadsRoutes from './uploads.routes';
import attendanceRoutes from './attendance.routes';
import leaveRoutes from './leave.routes';
import dashboardRoutes from './dashboard.routes';
import superadminRoutes from './superadmin.routes';

const router = Router();

// Everything under this router uses the {data,error,meta} envelope (ADR-1) —
// marked once here so the central error handler's fallback path is correct
// even for an error thrown before a specific handler's own response helper
// would have run.
router.use(markRouteGroup('admin'));

router.use('/auth', authRoutes);
router.use('/employees', employeesRoutes);
router.use('/offices', officesRoutes);
router.use('/geofences', geofencesRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/dashboard', dashboardRoutes);
// Person 2's contract mounts admins/audit/spoof-alerts/billing/policy at the
// top level (GET /admins, not GET /superadmin/admins) — no shared prefix.
router.use('/', superadminRoutes);

export default router;
