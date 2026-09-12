/**
 * Mobile auth (DECISIONS.md N3, closing ADR-6). Reuses the same JWT issuance
 * as admin's authService — same User/Role lookup, same signAccessToken/
 * signRefreshToken — just keyed on employee_code instead of email, and
 * password-only (no PIN at login; the PIN is verified once per check-in via
 * Person 4's service, not here — see attendanceService.performCheckin).
 */
import { Role, User } from '../models';
import { toRoleKey } from '../constants';
import { comparePassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken, InvalidTokenError } from '../utils/jwt';
import { MobileApiError } from '../utils/errors';

async function resolveRoleName(roleId: unknown): Promise<string> {
  const role = await Role.findById(roleId).lean();
  return role?.role_name ?? 'Employee';
}

export interface MobileLoginResult {
  access_token: string;
  refresh_token: string;
  user: { _id: string; name: string; employee_code?: string | null; email: string };
}

export async function mobileLogin(employeeCode: string, password: string): Promise<MobileLoginResult> {
  const user = await User.findOne({ employee_code: employeeCode.trim() }).select('+password_hash');
  if (!user || !user.password_hash) {
    throw new MobileApiError(401, 'invalid_credentials');
  }
  if (!user.is_active) {
    throw new MobileApiError(403, 'account_inactive');
  }
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    throw new MobileApiError(401, 'invalid_credentials');
  }

  const roleName = await resolveRoleName(user.role_id);
  const roleKey = toRoleKey(roleName);
  const accessToken = signAccessToken(String(user._id), roleKey);
  const refreshToken = signRefreshToken(String(user._id), roleKey);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: { _id: String(user._id), name: user.name, employee_code: user.employee_code, email: user.email },
  };
}

export interface MobileRefreshResult {
  access_token: string;
  refresh_token: string;
}

export async function mobileRefresh(refreshToken: string): Promise<MobileRefreshResult> {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new MobileApiError(401, 'unauthenticated');
    }
    throw err;
  }

  const user = await User.findById(claims.sub);
  if (!user || !user.is_active) {
    throw new MobileApiError(401, 'unauthenticated');
  }

  const roleName = await resolveRoleName(user.role_id);
  const roleKey = toRoleKey(roleName);
  return {
    access_token: signAccessToken(String(user._id), roleKey),
    refresh_token: signRefreshToken(String(user._id), roleKey),
  };
}
