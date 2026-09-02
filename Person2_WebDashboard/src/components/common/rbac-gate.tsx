import type { ReactNode } from 'react';
import { can, type Permission } from '@/lib/rbac';
import { useSession } from '@/auth/auth-context';

/**
 * Hides UI the current role cannot use.
 *
 * This is interface hygiene, not access control: Person 3's API re-checks every
 * permission independently. Never rely on this to protect data.
 */
export function RbacGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const user = useSession();
  return can(user, permission) ? <>{children}</> : <>{fallback}</>;
}
