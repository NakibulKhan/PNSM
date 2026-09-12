/**
 * Role-based access control for the UI layer (FR-12).
 *
 * IMPORTANT: hiding a nav item is not security. Every permission checked here
 * MUST also be enforced by Person 3's API. This layer exists to keep the
 * interface honest, not to protect data.
 */
import type { RoleKey, RoleName, SessionUser } from '@/types/models';

export type Permission =
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
  | 'policy:write';

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

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  super_admin: SUPER_ADMIN_PERMISSIONS,
  admin_hr: HR_PERMISSIONS,
  employee: [],
};

/** Map Person 3's stored `role_name` onto our internal key. */
export function toRoleKey(roleName: RoleName | string): RoleKey {
  const normalised = String(roleName).trim().toLowerCase();
  if (normalised === 'super admin' || normalised === 'super_admin') return 'super_admin';
  if (normalised === 'admin' || normalised === 'admin/hr' || normalised === 'hr') return 'admin_hr';
  return 'employee';
}

export function toRoleName(role: RoleKey): RoleName {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin_hr') return 'Admin';
  return 'Employee';
}

export function can(user: Pick<SessionUser, 'role'> | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function canAny(user: Pick<SessionUser, 'role'> | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(user, permission));
}

/** Only these roles may sign in to the admin portal at all. */
export function isAdminRole(role: RoleKey): boolean {
  return role === 'super_admin' || role === 'admin_hr';
}

export const ROLE_LABEL: Record<RoleKey, string> = {
  super_admin: 'Super Admin',
  admin_hr: 'Admin / HR',
  employee: 'Employee',
};
