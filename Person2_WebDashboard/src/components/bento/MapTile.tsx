import type { ReactNode } from 'react';
import { BentoTile, type TileRank, type TileState } from './BentoTile';
import { TileHeader } from './TileHeader';
import { TileSkeleton } from './TileSkeleton';
import { TileError } from './TileError';

/**
 * A tile that hosts a MapLibre GL instance — never fetches data itself. Not
 * used by this phase's Dashboard screen (stubbed for the Geofence Studio /
 * Live Map phases, which own the actual WebGL-context lifecycle concerns).
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
