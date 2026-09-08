import type { ReactNode } from 'react';
import { BentoTile, useTileHeading, type TileRank } from './BentoTile';
import { cn } from '@/lib/utils';

/**
 * A single primary action, chip-ranked by default. Not used by this phase's
 * Dashboard screen (its actions live in `PageHeader`) — stubbed for later
 * screens (e.g. Geofence Studio's "Save geofence").
 */
export function ActionTile({
  rank = 'chip',
  label,
  icon,
  onClick,
  className,
}: {
  rank?: TileRank;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <BentoTile rank={rank} className={cn('p-0', className)}>
      <ActionTileButton label={label} icon={icon} onClick={onClick} />
    </BentoTile>
  );
}

function ActionTileButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  const { id } = useTileHeading();
  return (
    <button
      id={id}
      type="button"
      data-interactive
      onClick={onClick}
      className="flex h-full w-full items-center justify-center gap-2 rounded-[inherit] text-[13px] font-semibold text-accent hover:bg-accent-soft"
    >
      {icon}
      {label}
    </button>
  );
}
