import { Router } from 'express';
import { markRouteGroup } from '../../middleware/routeGroup';
import authRoutes from './auth.routes';

const router = Router();

// Everything under this router uses the {data,error,meta} envelope (ADR-1) —
// marked once here so the central error handler's fallback path is correct
// even for an error thrown before a specific handler's own response helper
// would have run.
router.use(markRouteGroup('admin'));

router.use('/auth', authRoutes);

export default router;
