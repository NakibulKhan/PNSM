/**
 * Mocks the persistence layer entirely — no live MongoDB connection is used
 * or required. This is a deliberate scope choice for this phase: DB-backed
 * integration tests (real Mongo, via Atlas or a local instance) are left for
 * an environment that actually has one, per this phase's test-strategy
 * note. What's verified here is real: route wiring, validation, the
 * mobile/admin response-convention split (ADR-1), RBAC role-neutrality on
 * /auth/me (ADR-4), and the actual JWT sign/verify path — nothing here is
 * faked except the two Mongoose model calls.
 *
 * jest.mock() is written ABOVE the imports on purpose: ts-jest does not
 * apply babel's automatic mock-hoisting, so with ts-jest the mock factory
 * must be registered before the module it targets is first required —
 * placing it first in source order (and letting tsc preserve that order in
 * the compiled output) achieves that without relying on hoisting.
 */
jest.mock('@/models', () => ({
  User: { findOne: jest.fn(), findById: jest.fn() },
  Role: { findById: jest.fn() },
}));

import request from 'supertest';
import { createApp } from '@/app';
import { User, Role } from '@/models';
import { hashPassword } from '@/utils/password';
import { signAccessToken, signRefreshToken } from '@/utils/jwt';

const mockedUser = User as unknown as { findOne: jest.Mock; findById: jest.Mock };
const mockedRole = Role as unknown as { findById: jest.Mock };

describe('admin auth routes', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    it('returns an access/refresh token pair for valid credentials', async () => {
      const passwordHash = await hashPassword('correct-password');
      mockedUser.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'u1',
          name: 'Rafiq Hasan',
          email: 'rafiq@company.com',
          password_hash: passwordHash,
          role_id: 'r1',
          is_active: true,
          reference_photo_url: null,
        }),
      });
      mockedRole.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ role_name: 'Employee' }) });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'rafiq@company.com', password: 'correct-password' });

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
      expect(res.body.data.user).toEqual(
        expect.objectContaining({ email: 'rafiq@company.com', role: 'employee', role_name: 'Employee' }),
      );
    });

    it('rejects an incorrect password with 401', async () => {
      const passwordHash = await hashPassword('correct-password');
      mockedUser.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'u1',
          name: 'Rafiq Hasan',
          email: 'rafiq@company.com',
          password_hash: passwordHash,
          role_id: 'r1',
          is_active: true,
          reference_photo_url: null,
        }),
      });

      const res = await request(app).post('/api/auth/login').send({ email: 'rafiq@company.com', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.data).toBeNull();
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an unknown email with 401 (same code as a wrong password — no user enumeration)', async () => {
      mockedUser.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      const res = await request(app).post('/api/auth/login').send({ email: 'nobody@company.com', password: 'whatever12' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a deactivated account with 403', async () => {
      const passwordHash = await hashPassword('correct-password');
      mockedUser.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'u1',
          name: 'Old Employee',
          email: 'gone@company.com',
          password_hash: passwordHash,
          role_id: 'r1',
          is_active: false,
          reference_photo_url: null,
        }),
      });
      const res = await request(app).post('/api/auth/login').send({ email: 'gone@company.com', password: 'correct-password' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('returns a validation error for a malformed email', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'whatever123' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('normalizes email case before the database lookup (defense-in-depth)', async () => {
      const passwordHash = await hashPassword('correct-password');
      mockedUser.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: 'u1',
          name: 'Rafiq Hasan',
          email: 'rafiq@company.com',
          password_hash: passwordHash,
          role_id: 'r1',
          is_active: true,
          reference_photo_url: null,
        }),
      });
      mockedRole.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ role_name: 'Employee' }) });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: '  RAFIQ@Company.com  ', password: 'correct-password' });

      expect(res.status).toBe(200);
      // Whatever case/whitespace the client sent, the actual Mongo query
      // must be lowercased and trimmed — both the zod schema AND the
      // service's own defense-in-depth normalization should guarantee this.
      expect(mockedUser.findOne).toHaveBeenCalledWith({ email: 'rafiq@company.com' });
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 with no Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('is role-neutral — returns 200 for an employee-role token (ADR-4)', async () => {
      mockedUser.findById.mockResolvedValue({
        _id: 'u1',
        name: 'Employee Person',
        email: 'emp@company.com',
        is_active: true,
        role_id: 'r-employee',
        reference_photo_url: null,
      });
      mockedRole.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ role_name: 'Employee' }) });

      const token = signAccessToken('u1', 'employee');
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('employee');
    });

    it('also succeeds for an admin_hr token — role-neutral in both directions', async () => {
      mockedUser.findById.mockResolvedValue({
        _id: 'u2',
        name: 'HR Person',
        email: 'hr@company.com',
        is_active: true,
        role_id: 'r-admin',
        reference_photo_url: null,
      });
      mockedRole.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ role_name: 'Admin' }) });

      const token = signAccessToken('u2', 'admin_hr');
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('admin_hr');
    });

    it('rejects an invalid token with 401', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues a new access token for a valid refresh token', async () => {
      const refreshToken = signRefreshToken('u1', 'admin_hr');
      mockedUser.findById.mockResolvedValue({ _id: 'u1', is_active: true, role_id: 'r1' });

      const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects a garbage refresh token with 401', async () => {
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'not-a-real-token-at-all' });
      expect(res.status).toBe(401);
    });
  });
});
