import { describe, expect, it } from 'vitest';
import { can, canAny, isAdminRole, ROLE_PERMISSIONS, toRoleKey, toRoleName } from '@/lib/rbac';
import type { SessionUser } from '@/types/models';

const asUser = (role: SessionUser['role']): Pick<SessionUser, 'role'> => ({ role });

describe('role mapping', () => {
  it('maps stored role names onto internal keys', () => {
    expect(toRoleKey('Super Admin')).toBe('super_admin');
    expect(toRoleKey('Admin')).toBe('admin_hr');
    expect(toRoleKey('HR')).toBe('admin_hr');
    expect(toRoleKey('Employee')).toBe('employee');
  });

  it('is case and whitespace tolerant', () => {
    expect(toRoleKey('  super admin ')).toBe('super_admin');
  });

  it('defaults unknown roles to the least privileged', () => {
    expect(toRoleKey('Intern')).toBe('employee');
  });

  it('round-trips back to a display name', () => {
    expect(toRoleName(toRoleKey('Super Admin'))).toBe('Super Admin');
  });
});

describe('permissions', () => {
  it('lets HR manage employees and review check-ins', () => {
    expect(can(asUser('admin_hr'), 'employee:write')).toBe(true);
    expect(can(asUser('admin_hr'), 'attendance:review')).toBe(true);
    expect(can(asUser('admin_hr'), 'report:export')).toBe(true);
  });

  it('withholds executive powers from HR', () => {
    expect(can(asUser('admin_hr'), 'admin:manage')).toBe(false);
    expect(can(asUser('admin_hr'), 'billing:read')).toBe(false);
    expect(can(asUser('admin_hr'), 'policy:write')).toBe(false);
    expect(can(asUser('admin_hr'), 'employee:deactivate')).toBe(false);
  });

  it('grants the Super Admin everything HR has, plus executive powers', () => {
    ROLE_PERMISSIONS.admin_hr.forEach((permission) => {
      expect(can(asUser('super_admin'), permission)).toBe(true);
    });
    expect(can(asUser('super_admin'), 'admin:manage')).toBe(true);
    expect(can(asUser('super_admin'), 'audit:read')).toBe(true);
  });

  it('gives a plain employee no console access at all', () => {
    expect(ROLE_PERMISSIONS.employee).toHaveLength(0);
    expect(can(asUser('employee'), 'dashboard:view')).toBe(false);
    expect(isAdminRole('employee')).toBe(false);
  });

  it('treats a missing user as unauthorised rather than throwing', () => {
    expect(can(null, 'dashboard:view')).toBe(false);
    expect(can(undefined, 'dashboard:view')).toBe(false);
  });

  it('supports any-of checks', () => {
    expect(canAny(asUser('admin_hr'), ['admin:manage', 'employee:read'])).toBe(true);
    expect(canAny(asUser('admin_hr'), ['admin:manage', 'billing:read'])).toBe(false);
  });
});
