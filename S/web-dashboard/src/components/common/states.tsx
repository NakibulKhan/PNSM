import * as React from 'react';
import { Inbox, WifiOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Empty and failure states.
 *
 * Copy rule followed here: an empty screen invites an action, and an error
 * says what happened and what to do. Neither apologises.
 */
export function EmptyState({
  title,
  message,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
  icon?: typeof Inbox;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <Icon size={22} className="mb-3 text-faint" aria-hidden />
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'That request did not complete',
  message,
  action,
  className,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <AlertTriangle size={22} className="mb-3 text-flagged" aria-hidden />
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[12.5px] text-muted">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Shown when the backend is asleep rather than broken. Render's free instances
 * spin down after 15 minutes of inactivity and take 30-60 seconds to wake, so
 * this has to read as waiting, not failing.
 */
export function WakingState({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <WifiOff size={22} className="mb-3 text-accent" aria-hidden />
      <p className="text-[13.5px] font-semibold text-ink">Waking up the server</p>
      <p className="mt-1 max-w-md text-[12.5px] text-muted">
        The free-tier backend sleeps when idle. This can take up to a minute — the page will fill in
        on its own.
      </p>
    </div>
  );
}

/**
 * Blocking spinner for the boot window, while the silent refresh decides
 * whether there is a session. It must NOT look like an error: a returning
 * administrator sees this for a few hundred milliseconds on every page load.
 */
export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3" role="status">
      <span
        aria-hidden
        className="spin-slow h-5 w-5 rounded-full border-2 border-line-strong border-t-accent"
      />
      <p className="text-[12.5px] text-muted">{label}</p>
    </div>
  );
}

/** Placeholder while a lazily-imported route chunk downloads. */
export function RouteFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading screen">
      <div className="h-8 w-64 animate-pulse rounded-sm bg-line/70" />
      <div className="kpi-grid grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[92px] animate-pulse rounded-sm bg-line/70" />
        ))}
      </div>
      <div className="h-[300px] w-full animate-pulse rounded-sm bg-line/70" />
    </div>
  );
}
