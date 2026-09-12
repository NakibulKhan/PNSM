/**
 * Router-level access guards.
 *
 * READ THIS BEFORE TRUSTING IT
 * ----------------------------
 * OWASP A01 (Broken Access Control) is explicit that application security must
 * never rely on client-side routing guards. Everything in this file is
 * *usability*: it stops an administrator from landing on a screen that would
 * only render errors, and it keeps the navigation honest.
 *
 * The actual enforcement is Express middleware verifying the JWT signature and
 * the role claim on every single protected route. If this file were deleted, a
 * determined user could reach any URL — and would receive 403s from the API for
 * everything they are not entitled to. That is the security boundary.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';
import { can, type Permission } from '@/lib/rbac';
import { FullPageSpinner } from '@/components/common/states';

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  // The boot refresh is still in flight; redirecting now would sign out a
  // perfectly valid session on every page reload.
  if (status === 'loading') return <FullPageSpinner label="Restoring your session" />;

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const { user, status } = useAuth();

  if (status === 'loading') return <FullPageSpinner label="Checking your access" />;
  if (!can(user, permission)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const location = useLocation() as { state?: { from?: string } };

  if (status === 'loading') return <FullPageSpinner label="Loading" />;
  if (status === 'authenticated') {
    const from = location.state?.from;
    return <Navigate to={from && from.startsWith('/') ? from : '/dashboard'} replace />;
  }

  return <Outlet />;
}
