import type { ReactNode } from 'react';
import { BentoTile, type TileRank, type TileState } from './BentoTile';
import { TileHeader } from './TileHeader';
import { TileSkeleton } from './TileSkeleton';
import { TileEmpty } from './TileEmpty';
import { TileError } from './TileError';
import { cn } from '@/lib/utils';

/** A tile that hosts a scrollable, live-updating list — never fetches data itself. */
export function FeedTile({
  rank,
  state = 'ready',
  title,
  support,
  action,
  footer,
  emptyTitle = 'Nothing yet',
  emptyMessage = 'This fills in as events arrive.',
  errorTitle,
  errorMessage,
  errorWaking = false,
  ariaLive = false,
  children,
}: {
  rank: TileRank;
  state?: TileState;
  title: string;
  support?: string;
  action?: ReactNode;
  footer?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Override for the 'error' state's TileError copy — e.g. for a waking backend (isBackendWaking). */
  errorTitle?: string;
  errorMessage?: string;
  errorWaking?: boolean;
  /** Set on the feed's own scroll region — announce the arriving record, not the whole tile. */
  ariaLive?: boolean;
  children: ReactNode;
}) {
  return (
    <BentoTile rank={rank} state={state}>
      <TileHeader title={title} support={support} action={action} />
      <div
        className={cn('scrollbar-slim min-h-0 flex-1 overflow-y-auto')}
        aria-live={ariaLive ? 'polite' : undefined}
        aria-atomic={ariaLive ? 'false' : undefined}
      >
        {state === 'loading' ? (
          <TileSkeleton />
        ) : state === 'error' ? (
          <TileError title={errorTitle} message={errorMessage} waking={errorWaking} />
        ) : state === 'empty' ? (
          <TileEmpty title={emptyTitle} message={emptyMessage} />
        ) : (
          children
        )}
      </div>
      {footer ? <div className="border-t border-hairline px-4 py-2">{footer}</div> : null}
    </BentoTile>
  );
}
