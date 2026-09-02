import { Router } from 'express';
import healthRoutes from './health.routes';
import adminRoutes from './admin';
import mobileRoutes from './mobile';

const router = Router();

router.use(healthRoutes);

// Mobile MUST be mounted before the bare '/api' admin group below, even
// though '/api/mobile' is textually a child of '/api': Express tries
// router.use() mounts in registration order and matches on path PREFIX, so
// with admin registered first, every /api/mobile/* request would match
// admin's '/api' prefix first and never reach this router at all. It would
// still 404 gracefully from a router with no matching route -- except
// admin/superadmin.routes.ts mounts `router.use(requireAuth('admin'))` at
// its own bare '/', which is Person 2's contract requiring routes like
// GET /admins with no prefix (see that file's own comment) but also means
// it silently catches ANY unmatched path under '/api', admin's own 404s
// included. The two facts compound: every single mobile endpoint —
// login included — returned 401 "Sign in required." from admin's auth
// gate, never reaching mobileRoutes, and mobile's own real backend was
// therefore never actually reachable. A live end-to-end run (ROADMAP.md
// Phase 5) caught this; every prior mobile verification ran against
// VITE_MOCK_BACKEND=true, which never makes this specific HTTP request at
// all. DECISIONS.md N3 explains why mobile needs its own path family in
// the first place; this comment explains why the mount ORDER is what
// actually makes that hold at runtime, not just in the route strings.
router.use('/api/mobile', mobileRoutes);

// Person 2's API_BASE_URL already ends in /api, and their endpoint table
// omits the prefix for that reason (architecture report §1) — mounting the
// admin group under /api here reproduces that exact path shape.
router.use('/api', adminRoutes);

export default router;
