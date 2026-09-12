import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type TileRank = 'hero' | 'wide' | 'tall' | 'square' | 'chip' | 'rail';

/** The six states every tile must define (master prompt §9). 'ready' renders children as-is. */
export type TileState = 'ready' | 'loading' | 'empty' | 'partial' | 'error' | 'offline' | 'locked';

const TileHeadingContext = createContext<{ id: string; level: 'h2' | 'h3' } | null>(null);

/** Read by TileHeader (or any tile that rolls its own heading markup) to link `aria-labelledby`. */
export function useTileHeading() {
  const ctx = useContext(TileHeadingContext);
  if (!ctx) {
    throw new Error('useTileHeading must be used within a BentoTile');
  }
  return ctx;
}

/**
 * One Bento compartment. Never fetches data itself (master prompt §11) — the
 * caller passes `state` and `children`; this only handles rank→span, the
 * `rank-*` fallback class, and the section/aria wiring. Hero tiles render an
 * `h2` heading (master prompt §10, "hero is h2 under the page h1"); every
 * other rank renders `h3`.
 */
export function BentoTile({
  rank,
  state = 'ready',
  span,
  className,
  children,
}: {
  rank: TileRank;
  state?: TileState;
  /** Escape hatch for a one-off span that differs from the rank default. */
  span?: string;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  const level = rank === 'hero' ? 'h2' : 'h3';

  return (
    <TileHeadingContext.Provider value={{ id: headingId, level }}>
      <section
        aria-labelledby={headingId}
        data-tile-state={state}
        className={cn('bento-tile', `rank-${rank}`, span, className)}
      >
        {children}
      </section>
    </TileHeadingContext.Provider>
  );
}
