/**
 * Backend-authoritative RBAC. Person 2's own risk register is explicit that
 * hiding a nav item is not security (their RbacGate is documented as
 * "interface hygiene, not access control") — every permission their frontend
 * checks MUST also be enforced here. This matrix is a strict superset of
 * their admin matrix (report §5 / Conflict C8): it keeps every permission
 * from Person 2's rbac.ts unchanged, and adds an `employee` scope their app
 * never needed because it doesn't cover the mobile flows.
 */
import type { Request, Response, NextFunction } from 'express';
import type { RoleKey } from '../constants';

export type Permission =
  // --- Person 2's admin matrix, unchanged ---
  | 'dashboard:view'
  | 'employee:read'
  | 'employee:write'
  | 'employee:deactivate'
  | 'geofence:read'
  | 'geofence:write'
  | 'attendance:read'
  | 'attendance:review'
  | 'leave:read'
  | 'leave:write'
  | 'report:export'
  | 'livemap:view'
  | 'settings:read'
  | 'admin:manage'
  | 'audit:read'
  | 'billing:read'
  | 'policy:write'
  // --- New: employee scope (Conflict C8), absent from Person 2's matrix ---
  | 'attendance:checkin'
  | 'attendance:self-read'
  | 'leave:self-write'
  | 'leave:self-read'
  | 'dashboard:self-view';

const HR_PERMISSIONS: Permission[] = [
  'dashboard:view',
  'employee:read',
  'employee:write',
  'geofence:read',
  'geofence:write',
  'attendance:read',
  'attendance:review',
  'leave:read',
  'leave:write',
  'report:export',
  'livemap:view',
  'settings:read',
];

const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  ...HR_PERMISSIONS,
  'employee:deactivate',
  'admin:manage',
  'audit:read',
  'billing:read',
  'policy:write',
];

const EMPLOYEE_PERMISSIONS: Permission[] = [
  'attendance:checkin',
  'attendance:self-read',
  'leave:self-write',
  'leave:self-read',
  'dashboard:self-view',
];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  super_admin: SUPER_ADMIN_PERMISSIONS,
  admin_hr: HR_PERMISSIONS,
  employee: EMPLOYEE_PERMISSIONS,
};

export function can(role: RoleKey | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isAdminRole(role: RoleKey): boolean {
  return role === 'super_admin' || role === 'admin_hr';
}

/**
 * Route guard. Requires `req.auth` to already be set by the auth middleware.
 * Employees are refused any permission outside EMPLOYEE_PERMISSIONS — they
 * cannot reach admin resources, and (separately, at the route/query layer)
 * must be scoped to only their own records even for the permissions they do
 * hold (e.g. `attendance:self-read` still filters by their own user id).
 *
 * Takes an explicit response-convention `group`, same reasoning as
 * requireAuth() in src/middleware/auth.ts (ADR-1 compatibility for the
 * employee-scoped permissions above, which exist for Phase 2 mobile routes
 * that don't exist yet). Defaults to 'admin', matching every current call
 * site and existing test expectations exactly.
 */
export function requirePermission(permission: Permission, group: 'mobile' | 'admin' = 'admin') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      sendAuthFailure(res, group, 401, 'UNAUTHENTICATED', 'unauthenticated', 'Sign in required.');
      return;
    }
    if (!can(req.auth.role, permission)) {
      sendAuthFailure(res, group, 403, 'FORBIDDEN', 'forbidden', 'You do not have permission to perform this action.');
      return;
    }
    next();
  };
}

function sendAuthFailure(
  res: Response,
  group: 'mobile' | 'admin',
  status: 401 | 403,
  code: string,
  mobileReason: string,
  message: string,
): void {
  if (group === 'mobile') {
    res.status(status).json({ status: 'rejected', reason: mobileReason, face_match_score: null });
    return;
  }
  res.status(status).json({ data: null, error: { code, message } });
}
