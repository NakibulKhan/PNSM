/**
 * DECISIONS.md N18: the seed script (src/scripts/seed.ts) is the only way
 * to create the first Super Admin on a fresh database — no signup route
 * exists, by design (N3). This tests its two idempotent building blocks
 * directly rather than the guarded `main()`, which connects to a real
 * database and is exercised live via SETUP.md's own instructions instead.
 *
 * jest.mock() ABOVE the imports for the same ts-jest hoisting reason
 * documented in auth.test.ts.
 */
jest.mock('@/models', () => ({
  Role: { updateOne: jest.fn(), findOne: jest.fn() },
  User: { findOne: jest.fn(), create: jest.fn() },
}));

import { Role, User } from '@/models';
import { ensureRoles, ensureSuperAdmin } from '@/scripts/seed';

const mockedRole = Role as unknown as { updateOne: jest.Mock; findOne: jest.Mock };
const mockedUser = User as unknown as { findOne: jest.Mock; create: jest.Mock };

describe('ensureRoles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts all three roles, never inserting over an existing one', async () => {
    mockedRole.updateOne.mockResolvedValue({ acknowledged: true });

    await ensureRoles();

    expect(mockedRole.updateOne).toHaveBeenCalledTimes(3);
    const roleNames = mockedRole.updateOne.mock.calls.map((call) => call[0].role_name);
    expect(roleNames.sort()).toEqual(['Admin', 'Employee', 'Super Admin'].sort());
    // Every call must use upsert + $setOnInsert — never a plain overwrite,
    // which would clobber `permissions` on a role that already has some.
    for (const call of mockedRole.updateOne.mock.calls) {
      const [, update, options] = call;
      expect(options).toEqual({ upsert: true });
      expect(update).toHaveProperty('$setOnInsert');
    }
  });
});

describe('ensureSuperAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PNSM_SEED_ADMIN_EMAIL;
    delete process.env.PNSM_SEED_ADMIN_PASSWORD;
  });

  it('creates a new Super Admin with a generated password when none exists', async () => {
    mockedUser.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockedRole.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'role-super-admin' }) });
    mockedUser.create.mockResolvedValue({ _id: 'new-user' });

    const result = await ensureSuperAdmin();

    expect(result.created).toBe(true);
    expect(result.email).toBe('admin@pnsm.local');
    expect(result.password).toEqual(expect.any(String));
    expect(result.password!.length).toBeGreaterThan(8); // not a trivially guessable default

    expect(mockedUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'admin@pnsm.local',
        role_id: 'role-super-admin',
        is_active: true,
        password_hash: expect.any(String),
      }),
    );
    // The plaintext password must never be what gets persisted.
    const createdArgs = mockedUser.create.mock.calls[0][0];
    expect(createdArgs.password_hash).not.toBe(result.password);
  });

  it('does nothing and reports created:false when the account already exists', async () => {
    mockedUser.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'existing-user' }) });

    const result = await ensureSuperAdmin();

    expect(result.created).toBe(false);
    expect(result.password).toBeUndefined();
    expect(mockedUser.create).not.toHaveBeenCalled();
  });

  it('uses PNSM_SEED_ADMIN_EMAIL and PNSM_SEED_ADMIN_PASSWORD when set, normalising the email', async () => {
    process.env.PNSM_SEED_ADMIN_EMAIL = '  HR@Example.com  ';
    process.env.PNSM_SEED_ADMIN_PASSWORD = 'a-real-chosen-password';
    mockedUser.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockedRole.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'role-super-admin' }) });
    mockedUser.create.mockResolvedValue({ _id: 'new-user' });

    const result = await ensureSuperAdmin();

    expect(result.email).toBe('hr@example.com');
    expect(result.password).toBe('a-real-chosen-password');
    expect(mockedUser.findOne).toHaveBeenCalledWith({ email: 'hr@example.com' });
  });

  it('throws rather than creating an unrooted user if the Super Admin role is somehow missing', async () => {
    mockedUser.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mockedRole.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(ensureSuperAdmin()).rejects.toThrow(/role missing/i);
    expect(mockedUser.create).not.toHaveBeenCalled();
  });
});
