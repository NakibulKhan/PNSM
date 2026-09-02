/**
 * Authenticated chrome: sidebar, topbar, and the single Socket.IO subscription.
 *
 * Because this layout is a parent route, it mounts once for the whole session.
 * The socket connects here and stays connected across every navigation — which
 * is the practical reason to use nested layouts rather than wrapping each page.
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { DemoModeBanner } from '@/components/common/demo-banner';
import { useAttendanceSocket } from '@/hooks/use-socket';

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const { state } = useAttendanceSocket(true);

  return (
    <div className="min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="lg:pl-[236px]">
        <Topbar connection={state} onOpenNav={() => setNavOpen(true)} />
        <DemoModeBanner />
        <main className="px-4 py-5 lg:px-6 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
