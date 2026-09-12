import { can, isAdminRole, requirePermission, ROLE_PERMISSIONS } from '@/middleware/rbac';
import type { Request, Response } from 'express';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('rbac', () => {
  it('gives super_admin every permission admin_hr has, plus more', () => {
    for (const permission of ROLE_PERMISSIONS.admin_hr) {
      expect(ROLE_PERMISSIONS.super_admin).toContain(permission);
    }
    expect(ROLE_PERMISSIONS.super_admin.length).toBeGreaterThan(ROLE_PERMISSIONS.admin_hr.length);
  });

  it('gives employees zero admin permissions', () => {
    expect(can('employee', 'employee:read')).toBe(false);
    expect(can('employee', 'admin:manage')).toBe(false);
    expect(can('employee', 'attendance:review')).toBe(false);
  });

  it('gives employees their own scoped permissions (Conflict C8)', () => {
    expect(can('employee', 'attendance:checkin')).toBe(true);
    expect(can('employee', 'attendance:self-read')).toBe(true);
    expect(can('employee', 'leave:self-write')).toBe(true);
  });

  it('does not give admin_hr the employee-only checkin permission', () => {
    expect(can('admin_hr', 'attendance:checkin')).toBe(false);
  });

  it('correctly identifies admin roles', () => {
    expect(isAdminRole('super_admin')).toBe(true);
    expect(isAdminRole('admin_hr')).toBe(true);
    expect(isAdminRole('employee')).toBe(false);
  });

  it('requirePermission() returns 401 when unauthenticated', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn();
    requirePermission('employee:read')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('requirePermission() returns 403 when authenticated but lacking the permission', () => {
    const req = { auth: { sub: 'u1', role: 'employee' } } as Request;
    const res = mockRes();
    const next = jest.fn();
    requirePermission('employee:read')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('requirePermission() calls next() when the role has the permission', () => {
    const req = { auth: { sub: 'u1', role: 'admin_hr' } } as Request;
    const res = mockRes();
    const next = jest.fn();
    requirePermission('employee:read')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
