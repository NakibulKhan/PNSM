/**
 * Regression test for a real bug this session's first live end-to-end run
 * (ROADMAP.md Phase 5) caught: `routes/index.ts` mounted admin's router at
 * '/api' BEFORE mobile's at '/api/mobile'. Express tries router.use() mounts
 * in registration order on path PREFIX, so /api/mobile/* always matched
 * admin's '/api' prefix first. It would still have 404'd harmlessly from
 * there — except admin/superadmin.routes.ts mounts
 * `router.use(requireAuth('admin'))` at its own bare '/' (required by
 * Person 2's contract for routes like GET /admins with no prefix), which
 * silently caught EVERY unmatched path under '/api' and rejected it with
 * 401 UNAUTHENTICATED instead of ever reaching mobileRoutes. Every single
 * mobile endpoint was unreachable on a real running server — including
 * login itself, so nothing to do with mobile could ever be exercised
 * without this failing first. No prior test caught it: the only two
 * supertest-backed integration tests before this one (auth.test.ts,
 * health.test.ts) only ever requested /api/auth/* paths, and every
 * mobile-client verification ran with VITE_MOCK_BACKEND=true, which never
 * makes this HTTP request at all.
 *
 * jest.mock() ABOVE the imports for the same ts-jest hoisting reason
 * documented in auth.test.ts.
 */
jest.mock('@/models', () => ({
  User: { findOne: jest.fn(), findById: jest.fn() },
  Role: { findById: jest.fn() },
}));

import request from 'supertest';
import { createApp } from '@/app';
import { User } from '@/models';

const mockedUser = User as unknown as { findOne: jest.Mock };

describe('mobile routes are actually reachable (not swallowed by admin/superadmin\'s catch-all auth gate)', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/mobile/auth/login reaches mobileAuthService, not admin\'s requireAuth catch-all', async () => {
    mockedUser.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null), // "no such employee_code" — still proves mobileLogin ran.
    });

    const res = await request(app)
      .post('/api/mobile/auth/login')
      .send({ employee_code: 'PNSM-E001', password: 'whatever123' });

    // The bug's signature: admin's catch-all replies 401 with the ADMIN
    // envelope shape ({data,error} where error.code is 'UNAUTHENTICATED')
    // BEFORE mobileAuthService.mobileLogin ever runs, so User.findOne is
    // never called with an employee_code filter at all. The fix's
    // signature: a 401 in the MOBILE bare-body shape, with the mobile-only
    // 'invalid_credentials' reason — proving this request actually reached
    // mobileAuthService.mobileLogin, not admin's gate.
    expect(mockedUser.findOne).toHaveBeenCalledWith({ employee_code: 'PNSM-E001' });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('error'); // admin's envelope shape
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe('invalid_credentials');
  });

  it('admin routes under /api still work normally (the reorder did not break them)', async () => {
    const res = await request(app).get('/api/dashboard/kpis');
    // Unauthenticated — admin's own requireAuth should still gate this
    // route exactly as before, proving the fix didn't just make admin
    // auth stop working instead.
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
