import type { ReactNode } from 'react';
import { useTileHeading } from './BentoTile';

/**
 * Title, one support line, one optional action — never a second heading
 * (master prompt §3 rule 1: a tile needing a second heading is two tiles).
 */
export function TileHeader({
  title,
  support,
  action,
}: {
  title: string;
  support?: string;
  action?: ReactNode;
}) {
  const { id, level: Level } = useTileHeading();

  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4">
      <div className="min-w-0">
        <Level id={id} className="truncate text-[15px] font-semibold text-ink">
          {title}
        </Level>
        {support ? <p className="mt-0.5 text-[13px] text-ink-muted">{support}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
