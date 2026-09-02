/**
 * Role-neutral by design (ADR-4, ADR-6): nothing here rejects an `employee`
 * role. This endpoint set is fully specified only for the admin console
 * (01-API-CONTRACT.md); it is usable by any User document with a
 * password_hash (which, per Person 1's OnboardingScreen, includes
 * employees — they set a password at onboarding even though they don't
 * choose their own PIN). Whether mobile actually uses this exact route is
 * still pending the flagged MOBILE AUTH CONTRACT REQUIRED dependency
 * (ADR-6) — if their real contract differs, only this file and its route
 * need to change, not the JWT core in utils/jwt.ts.
 */
import { User, Role } from '../models';
import { toRoleKey } from '../constants';
import { comparePassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken, InvalidTokenError } from '../utils/jwt';
import { AdminApiError } from '../utils/errors';
import type { SessionUserDTO } from '../types/models';

async function resolveRoleName(roleId: unknown): Promise<string> {
  const role = await Role.findById(roleId).lean();
  return role?.role_name ?? 'Employee';
}

function toSessionUser(user: {
  _id: unknown;
  name: string;
  email: string;
  reference_photo_url: string | null;
}, roleName: string): SessionUserDTO {
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    role: toRoleKey(roleName),
    role_name: roleName as SessionUserDTO['role_name'],
    reference_photo_url: user.reference_photo_url ?? null,
  };
}

export interface LoginResult {
  user: SessionUserDTO;
  accessToken: string;
  refreshToken: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  // Defense-in-depth: the route's zod schema already lowercases/trims this,
  // but this function shouldn't rely on every future caller doing the same
  // before a case-sensitive Mongo lookup — a mismatched case would silently
  // look like "wrong password" rather than the real cause.
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+password_hash');
  if (!user || !user.password_hash) {
    throw new AdminApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (!user.is_active) {
    throw new AdminApiError(403, 'ACCOUNT_INACTIVE', 'This account has been deactivated.');
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw new AdminApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }

  const roleName = await resolveRoleName(user.role_id);
  const roleKey = toRoleKey(roleName);
  const accessToken = signAccessToken(String(user._id), roleKey);
  const refreshToken = signRefreshToken(String(user._id), roleKey);

  return { user: toSessionUser(user, roleName), accessToken, refreshToken };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
}

export async function refresh(refreshToken: string): Promise<RefreshResult> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new AdminApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
    }
    throw err;
  }

  const user = await User.findById(claims.sub);
  if (!user || !user.is_active) {
    throw new AdminApiError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
  }

  const roleName = await resolveRoleName(user.role_id);
  const roleKey = toRoleKey(roleName);
  // Rotate BOTH tokens on refresh, not just the access token. The blueprint
  // calls for HttpOnly refresh cookie rotation; reissuing the refresh token
  // limits the window in which a stolen one stays valid.
  const accessToken = signAccessToken(String(user._id), roleKey);
  const rotatedRefreshToken = signRefreshToken(String(user._id), roleKey);
  return { accessToken, refreshToken: rotatedRefreshToken };
}

/** GET /auth/me — role-neutral, per ADR-4. Never 403s an employee token here. */
export async function getSessionUser(userId: string): Promise<SessionUserDTO> {
  const user = await User.findById(userId);
  if (!user || !user.is_active) {
    throw new AdminApiError(401, 'UNAUTHENTICATED', 'Sign in required.');
  }
  const roleName = await resolveRoleName(user.role_id);
  return toSessionUser(user, roleName);
}
