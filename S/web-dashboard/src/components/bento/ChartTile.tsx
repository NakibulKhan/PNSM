import type { ReactNode } from 'react';
import { BentoTile, type TileRank, type TileState } from './BentoTile';
import { TileHeader } from './TileHeader';
import { TileSkeleton } from './TileSkeleton';
import { TileEmpty } from './TileEmpty';
import { TileError } from './TileError';

/** A tile that hosts a chart (or any headed visual) — never fetches data itself. */
export function ChartTile({
  rank,
  state = 'ready',
  title,
  support,
  action,
  emptyTitle = 'No data yet',
  emptyMessage = 'The chart draws once there is something to show.',
  children,
}: {
  rank: TileRank;
  state?: TileState;
  title: string;
  support?: string;
  action?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  children: ReactNode;
}) {
  return (
    <BentoTile rank={rank} state={state}>
      <TileHeader title={title} support={support} action={action} />
      <div className="min-h-0 flex-1 p-4">
        {state === 'loading' ? (
          <TileSkeleton />
        ) : state === 'error' ? (
          <TileError />
        ) : state === 'empty' ? (
          <TileEmpty title={emptyTitle} message={emptyMessage} />
        ) : (
          children
        )}
      </div>
    </BentoTile>
  );
}
