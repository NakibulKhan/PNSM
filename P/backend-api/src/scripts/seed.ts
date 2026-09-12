/**
 * One-time bootstrap for a fresh database (ROADMAP.md Phase 5 / DECISIONS.md
 * N18): there is no signup route and none is planned — admin accounts are
 * created by an existing admin, and mobile employee accounts by an admin
 * console user (DECISIONS.md N3) — so a genuinely empty database has no way
 * to create its first account through the app itself. This script is that
 * one way in, run directly against the database rather than through the API.
 *
 * Idempotent: safe to run against a database that already has roles and/or
 * a Super Admin — it upserts the roles and does nothing to the account if
 * one already exists at PNSM_SEED_ADMIN_EMAIL, rather than erroring or
 * creating a duplicate.
 *
 *   npm run seed                                  # host, via ts-node
 *   node dist/scripts/seed.js                      # inside the compose
 *                                                    container — already
 *                                                    compiled in at image
 *                                                    build time, no devDeps
 *                                                    needed there
 *
 * PNSM_SEED_ADMIN_EMAIL and PNSM_SEED_ADMIN_PASSWORD are optional. Without
 * PNSM_SEED_ADMIN_PASSWORD a random one is generated and printed once —
 * same "generate and show exactly once" idiom this codebase already uses
 * for employee PINs and initial passwords (employeeService.ts).
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MONGODB_URI } from '../config/env';
import { Role, User } from '../models';
import { ROLE_NAMES } from '../constants';
import { hashPassword } from '../utils/password';

const DEFAULT_EMAIL = 'admin@pnsm.local';

export async function ensureRoles(): Promise<void> {
  for (const role_name of ROLE_NAMES) {
    await Role.updateOne({ role_name }, { $setOnInsert: { role_name, permissions: {} } }, { upsert: true });
  }
}

export async function ensureSuperAdmin(): Promise<{ created: boolean; email: string; password?: string }> {
  const email = (process.env.PNSM_SEED_ADMIN_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    return { created: false, email };
  }

  const role = await Role.findOne({ role_name: 'Super Admin' }).lean();
  if (!role) {
    // Cannot happen after ensureRoles() runs first, but fail loudly rather
    // than create a user with no role_id if that invariant is ever broken.
    throw new Error('Super Admin role missing after ensureRoles() — refusing to create an unrooted account.');
  }

  const password = process.env.PNSM_SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  const password_hash = await hashPassword(password);

  await User.create({
    name: 'Super Admin',
    email,
    password_hash,
    role_id: role._id,
    phone: '',
    department: 'HR',
    is_active: true,
    reference_photo_url: null,
  });

  return { created: true, email, password };
}

export async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  try {
    await ensureRoles();
    const result = await ensureSuperAdmin();

    if (result.created) {
      console.log('Super Admin account created.');
      console.log(`  email:    ${result.email}`);
      console.log(`  password: ${result.password}`);
      console.log('This password is shown once. Store it securely and change it after first login.');
    } else {
      console.log(`Super Admin already exists (${result.email}) — nothing to do.`);
    }
    console.log(`Roles ready: ${ROLE_NAMES.join(', ')}.`);
  } finally {
    await mongoose.disconnect();
  }
}

// Guarded so importing ensureRoles/ensureSuperAdmin/main from a test (which
// must not connect to a real database or call process.exit on import) is
// safe — only running this file directly (ts-node, or the compiled
// dist/scripts/seed.js) triggers the connect-and-run below.
if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
