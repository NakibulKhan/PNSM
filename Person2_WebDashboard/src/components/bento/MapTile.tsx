import type { ReactNode } from 'react';
import { BentoTile, type TileRank, type TileState } from './BentoTile';
import { TileHeader } from './TileHeader';
import { TileSkeleton } from './TileSkeleton';
import { TileError } from './TileError';

/**
 * A tile that hosts a MapLibre GL instance — never fetches data itself, and
 * owns none of the actual WebGL-context lifecycle (that's the caller's job).
 * Used by the Live Map screen (`live-presence.tsx`); Geofence Studio's map
 * (`geofence-map.tsx`) predates this primitive and rolls its own tile markup.
 */
export function MapTile({
  rank,
  span,
  state = 'ready',
  title,
  support,
  action,
  children,
}: {
  rank: TileRank;
  span?: string;
  state?: TileState;
  title: string;
  support?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <BentoTile rank={rank} span={span} state={state} className="overflow-hidden !p-0">
      <TileHeader title={title} support={support} action={action} />
      <div className="min-h-0 flex-1">
        {state === 'loading' ? <TileSkeleton /> : state === 'error' ? <TileError /> : children}
      </div>
    </BentoTile>
  );
}
