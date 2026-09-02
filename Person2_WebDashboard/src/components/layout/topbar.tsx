import { useState } from 'react';
import { Menu, LogOut, Search } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConnectionStatus } from './connection-status';
import { useAuth } from '@/auth/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { formatDate } from '@/lib/tz';
import { APP_TIMEZONE } from '@/lib/constants';
import type { ConnectionState } from '@/hooks/use-socket';

export function Topbar({
  connection,
  onOpenNav,
}: {
  connection: ConnectionState;
  onOpenNav: () => void;
}) {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-sm lg:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-sm border border-line-strong p-1.5 text-muted transition-colors hover:bg-canvas hover:text-ink lg:hidden"
      >
        <Menu size={16} aria-hidden />
      </button>

      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        <span className="tnum text-[12px] text-faint">
          {formatDate(new Date())} · {APP_TIMEZONE}
        </span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3 md:flex-none">
        <ConnectionStatus state={connection} />

        <div className="hidden items-center gap-2.5 border-l border-line pl-3 sm:flex">
          <Avatar name={user?.name ?? 'Admin'} src={user?.reference_photo_url} size={28} />
          <div className="min-w-0">
            <p className="max-w-[150px] truncate text-[12.5px] font-semibold leading-tight text-ink">
              {user?.name ?? 'Admin'}
            </p>
            <p className="text-[10.5px] leading-tight text-faint">
              {user ? ROLE_LABEL[user.role] : ''}
            </p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={handleSignOut} loading={signingOut} title="Sign out">
          <LogOut size={14} aria-hidden />
          <span className="sr-only sm:not-sr-only">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

/** Search field used by list screens; kept here so the header owns its idiom. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-sm border border-line-strong bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:w-64"
      />
    </div>
  );
}
