/**
 * Cross-cutting constants. Change here, never inline — same discipline
 * Person 2 documents in their own constants.ts.
 */

/** Canonical role names as stored on the Role document (matches Person 2's RoleName). */
export const ROLE_NAMES = ['Super Admin', 'Admin', 'Employee'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Normalised internal role key, matches Person 2's RoleKey. */
export const ROLE_KEYS = ['super_admin', 'admin_hr', 'employee'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Map a stored role_name onto the internal key — mirrors Person 2's rbac.ts toRoleKey(). */
export function toRoleKey(roleName: string): RoleKey {
  const normalised = roleName.trim().toLowerCase();
  if (normalised === 'super admin' || normalised === 'super_admin') return 'super_admin';
  if (normalised === 'admin' || normalised === 'admin/hr' || normalised === 'hr') return 'admin_hr';
  return 'employee';
}

export function toRoleName(roleKey: RoleKey): RoleName {
  if (roleKey === 'super_admin') return 'Super Admin';
  if (roleKey === 'admin_hr') return 'Admin';
  return 'Employee';
}

/** FR-07 / ADR-5: binary face-match outcome. Policy.face_match_threshold overrides this default. */
export const DEFAULT_FACE_MATCH_THRESHOLD = 85;

export const LEAVE_TYPES = ['casual', 'sick', 'earned'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const CHECK_TYPES = ['check_in', 'check_out'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

export const ATTENDANCE_STATUSES = ['approved', 'flagged', 'rejected'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Socket.IO event names — must match Person 2's constants.ts exactly (architecture report §8). */
export const SOCKET_EVENTS = {
  attendanceNew: 'attendance:new',
  attendanceFlagged: 'attendance:flagged',
  spoofAlert: 'spoof:alert',
  notificationNew: 'notification:new',
} as const;

/** Exact string Person 2's client pattern-matches on to trigger refresh+reconnect (report §8). */
export const SOCKET_AUTH_FAILURE_MESSAGE = 'invalid credentials';

export const APP_TIMEZONE = 'Asia/Dhaka';

/** Default late-arrival cutoff, Dhaka wall-clock time — overridable via Policy. */
export const DEFAULT_LATE_ARRIVAL_CUTOFF = '09:15';

export const DEFAULT_GEOFENCE_RADIUS_METERS = 100;

/** Bangladesh bounding box — coordinate flip sanity guard (architecture report §6). */
export const BD_BOUNDS = {
  minLat: 20.5,
  maxLat: 26.7,
  minLng: 88.0,
  maxLng: 92.7,
} as const;
