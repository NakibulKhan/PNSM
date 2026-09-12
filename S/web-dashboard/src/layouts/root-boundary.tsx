/**
 * Outermost shell: providers plus the global error boundary.
 *
 * Provider order is load-bearing. AuthProvider needs the router (it navigates on
 * session expiry) and the Axios layer, so it sits inside RouterProvider but
 * outside everything that reads the session. QueryProvider wraps it so the
 * auth-driven refetches have a client to talk to.
 */
import { Outlet, useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { QueryProvider } from '@/components/providers/query-provider';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/common/states';

export function RootBoundary() {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

/** Rendered by React Router when a route throws during render or lazy loading. */
export function RouteErrorBoundary() {
  const error = useRouteError();

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md">
        <ErrorState
          title="This screen did not load"
          message={message}
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      </div>
    </div>
  );
}
