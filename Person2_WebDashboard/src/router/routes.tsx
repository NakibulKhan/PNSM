/**
 * Route table — React Router v7, data mode via `createBrowserRouter`.
 *
 * Nested layouts mean the shell (sidebar, topbar, socket connection) mounts once
 * and survives every navigation: moving between screens swaps only the
 * `<Outlet />`, so the WebSocket is never torn down and re-established, and the
 * live feed keeps streaming while the user works.
 *
 * Guards compose as parent routes rather than wrappers inside each page, so a
 * new screen inherits the correct protection by being placed in the right
 * branch. Forgetting a guard requires actively putting a route in the wrong
 * place.
 *
 * Every page is lazily imported. The entry chunk therefore contains the shell
 * and nothing else, which matters for a single-page bundle served cold from
 * CloudFront.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from '@/auth/protected-route';
import { AppLayout } from '@/layouts/app-layout';
import { RootBoundary } from '@/layouts/root-boundary';
import { RouteFallback } from '@/components/common/states';

const LoginPage = lazy(() => import('@/pages/login'));
const DashboardPage = lazy(() => import('@/pages/dashboard'));
const EmployeesPage = lazy(() => import('@/pages/employees'));
const NewEmployeePage = lazy(() => import('@/pages/employee-new'));
const EmployeeDetailPage = lazy(() => import('@/pages/employee-detail'));
const GeofencesPage = lazy(() => import('@/pages/geofences'));
const AttendancePage = lazy(() => import('@/pages/attendance'));
const FlaggedPage = lazy(() => import('@/pages/flagged'));
const LeavePage = lazy(() => import('@/pages/leave'));
const LiveMapPage = lazy(() => import('@/pages/live-map'));
const ReportsPage = lazy(() => import('@/pages/reports'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const AdminsPage = lazy(() => import('@/pages/admin/admins'));
const PolicyPage = lazy(() => import('@/pages/admin/policy'));
const AuditPage = lazy(() => import('@/pages/admin/audit'));
const BillingPage = lazy(() => import('@/pages/admin/billing'));
const NotFoundPage = lazy(() => import('@/pages/not-found'));

/** Each lazy page gets its own boundary so one slow chunk cannot blank the shell. */
const page = (element: ReactNode) => <Suspense fallback={<RouteFallback />}>{element}</Suspense>;

export const router = createBrowserRouter([
  {
    element: <RootBoundary />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [{ path: '/login', element: page(<LoginPage />) }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },

              {
                element: <RequirePermission permission="dashboard:view" />,
                children: [{ path: '/dashboard', element: page(<DashboardPage />) }],
              },
              {
                element: <RequirePermission permission="employee:read" />,
                children: [
                  { path: '/employees', element: page(<EmployeesPage />) },
                  { path: '/employees/:id', element: page(<EmployeeDetailPage />) },
                ],
              },
              {
                element: <RequirePermission permission="employee:write" />,
                children: [{ path: '/employees/new', element: page(<NewEmployeePage />) }],
              },
              {
                element: <RequirePermission permission="geofence:read" />,
                children: [{ path: '/geofences', element: page(<GeofencesPage />) }],
              },
              {
                element: <RequirePermission permission="attendance:read" />,
                children: [{ path: '/attendance', element: page(<AttendancePage />) }],
              },
              {
                element: <RequirePermission permission="attendance:review" />,
                children: [{ path: '/flagged', element: page(<FlaggedPage />) }],
              },
              {
                element: <RequirePermission permission="leave:read" />,
                children: [{ path: '/leave', element: page(<LeavePage />) }],
              },
              {
                element: <RequirePermission permission="livemap:view" />,
                children: [{ path: '/live-map', element: page(<LiveMapPage />) }],
              },
              {
                element: <RequirePermission permission="report:export" />,
                children: [{ path: '/reports', element: page(<ReportsPage />) }],
              },
              {
                element: <RequirePermission permission="settings:read" />,
                children: [{ path: '/settings', element: page(<SettingsPage />) }],
              },

              // ---- Super Admin ------------------------------------------------
              {
                element: <RequirePermission permission="admin:manage" />,
                children: [{ path: '/admins', element: page(<AdminsPage />) }],
              },
              {
                element: <RequirePermission permission="policy:write" />,
                children: [{ path: '/policy', element: page(<PolicyPage />) }],
              },
              {
                element: <RequirePermission permission="audit:read" />,
                children: [{ path: '/audit', element: page(<AuditPage />) }],
              },
              {
                element: <RequirePermission permission="billing:read" />,
                children: [{ path: '/billing', element: page(<BillingPage />) }],
              },
            ],
          },
        ],
      },

      /*
       * Client-side 404. Note this only fires for paths React Router does not
       * recognise AFTER the app has loaded. A cold request for an unknown deep
       * link is answered by CloudFront, which must be configured to return
       * /index.html with a 200 so the app boots and this route can render.
       * See docs/02-BUG-BIBLE.md §1.
       */
      { path: '*', element: page(<NotFoundPage />) },
    ],
  },
]);
