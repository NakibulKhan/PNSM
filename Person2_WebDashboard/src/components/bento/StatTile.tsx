import type { ReactNode } from 'react';
import { BentoTile, useTileHeading, type TileRank, type TileState } from './BentoTile';
import { TileSkeleton } from './TileSkeleton';
import { TileError } from './TileError';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'accent' | 'verified' | 'flagged' | 'rejected';

const RULE: Record<Tone, string> = {
  neutral: 'bg-line-strong',
  accent: 'bg-accent',
  verified: 'bg-verified',
  flagged: 'bg-flagged',
  rejected: 'bg-rejected',
};

/**
 * A single-metric Bento chip/hero tile. Reuses `Stat`'s existing visual
 * language (tone accent rule, eyebrow label, tabular value, footnote) — see
 * `src/components/common/stat.tsx` — rather than nesting a second `.card`
 * inside `.bento-tile`. The eyebrow label doubles as the tile's own
 * accessible heading (§10: every tile is a `<section aria-labelledby>`); it
 * is the tile's name, not decoration floating above a separate heading, so
 * it is kept rather than dropped for the master prompt's generic-eyebrow ban
 * (see the Bento plan's judgment call #2).
 */
export function StatTile({
  rank = 'chip',
  state = 'ready',
  label,
  value,
  suffix,
  tone = 'neutral',
  footnote,
  className,
}: {
  rank?: TileRank;
  state?: TileState;
  label: string;
  value: string | number;
  suffix?: string;
  tone?: Tone;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <BentoTile rank={rank} state={state} className={cn('relative overflow-hidden p-3.5', className)}>
      {state === 'loading' ? (
        <TileSkeleton />
      ) : state === 'error' ? (
        <TileError />
      ) : (
        <StatTileBody label={label} value={value} suffix={suffix} tone={tone} footnote={footnote} />
      )}
    </BentoTile>
  );
}

function StatTileBody({
  label,
  value,
  suffix,
  tone,
  footnote,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone: Tone;
  footnote?: ReactNode;
}) {
  const { id } = useTileHeading();

  return (
    <>
      <span className={cn('absolute inset-x-0 top-0 h-[2px]', RULE[tone])} aria-hidden />
      <p id={id} className="eyebrow">
        {label}
      </p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-[26px] font-semibold leading-none text-ink">{value}</span>
        {suffix ? <span className="tnum text-[14px] font-semibold text-ink-muted">{suffix}</span> : null}
      </p>
      {footnote ? <p className="mt-1.5 text-[11.5px] text-ink-faint">{footnote}</p> : null}
    </>
  );
}
