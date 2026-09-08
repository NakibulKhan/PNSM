import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { can } from '@/lib/rbac';
import { navGroups } from './nav-config';
import { useSession } from '@/auth/auth-context';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { AttendanceLog, LeaveRequest } from '@/types/models';

/**
 * Primary navigation. Below `lg` it becomes an off-canvas panel, so the console
 * remains usable on the tablets HR staff carry around a site.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const user = useSession();

  const { data: flaggedCount = 0 } = useQuery({
    queryKey: queryKeys.flagged,
    queryFn: async () => {
      const rows = await fetchData<AttendanceLog[]>('attendance', { status: 'flagged', pageSize: 100 });
      return rows.length;
    },
    enabled: can(user, 'attendance:review'),
    staleTime: 30_000,
  });

  const { data: pendingLeave = 0 } = useQuery({
    queryKey: queryKeys.leave('pending'),
    queryFn: async () => {
      const rows = await fetchData<LeaveRequest[]>('leave', { status: 'pending' });
      return rows.length;
    },
    enabled: can(user, 'leave:read'),
    staleTime: 60_000,
  });

  const badgeValue = (key?: 'flagged' | 'leave') => {
    if (key === 'flagged') return flaggedCount;
    if (key === 'leave') return pendingLeave;
    return 0;
  };

  return (
    <>
      {/* A dimming scrim must always darken, in either theme — bg-black, not the
          theme-adaptive bg-ink (which is near-white by default now). */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          'fixed inset-0 z-30 bg-black/45 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Nav rail chrome stays dark regardless of [data-theme] (same reasoning as
          login.tsx's brand panel) — bg-ink/border-ink-line would otherwise invert
          with the app's theme and leave white-on-white text. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-[#0f1b2d] text-white transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold tracking-[-0.01em]">PNSM Command</p>
            <p className="mt-0.5 text-[10.5px] tracking-[0.06em] text-white/45">
              WORKFORCE ATTENDANCE
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-xs p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <nav className="scrollbar-slim flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => {
            const visible = group.items.filter((item) => can(user, item.permission));
            if (visible.length === 0) return null;

            return (
              <div key={group.label ?? 'primary'} className="mb-4">
                {group.label ? (
                  <p className="px-2.5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white/35">
                    {group.label}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {visible.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const count = badgeValue(item.badgeKey);
                    const Icon = item.icon;

                    return (
                      <li key={item.href}>
                        <Link
                          to={item.href}
                          onClick={onClose}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-[12.5px] font-medium transition-colors',
                            active
                              ? 'bg-white/12 text-white shadow-[inset_2px_0_0_var(--color-accent)]'
                              : 'text-white/65 hover:bg-white/8 hover:text-white',
                          )}
                        >
                          <Icon size={15} className="shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {count > 0 ? (
                            <span className="tnum rounded-full bg-flagged px-1.5 py-px text-[10px] font-semibold text-white">
                              {count}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-[10.5px] leading-relaxed text-white/40">
            Group 8 · CSE482L
            <br />
            North South University
          </p>
        </div>
      </aside>
    </>
  );
}
