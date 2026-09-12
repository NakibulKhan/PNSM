import { BentoGrid } from '@/components/bento/BentoGrid';
import { StatTile } from '@/components/bento/StatTile';
import { ChartTile } from '@/components/bento/ChartTile';
import { FeedTile } from '@/components/bento/FeedTile';
import type { TileRank, TileState } from '@/components/bento/BentoTile';

/**
 * Dev-only Bento primitive preview — one tile of each rank, in every state,
 * at all three breakpoints (resize the window to check). Not linked from any
 * nav; reachable only in `import.meta.env.DEV` (see router/routes.tsx).
 * Satisfies the migration's Phase 2 exit criterion: "primitives render at all
 * three breakpoints" (PNSM_Bento_Frontend_Master_Prompt.md §12).
 */
const RANKS: TileRank[] = ['hero', 'wide', 'tall', 'square', 'chip', 'rail'];
const STATES: TileState[] = ['ready', 'loading', 'empty', 'error'];

export default function BentoPreviewPage() {
  return (
    <div className="space-y-8 p-6">
      <h1 className="text-lg font-semibold text-ink">Bento primitive preview</h1>

      {STATES.map((state) => (
        <section key={state} className="space-y-2">
          <h2 className="eyebrow">{state}</h2>
          <BentoGrid>
            {RANKS.map((rank) => (
              <ChartTile
                key={`${state}-${rank}`}
                rank={rank}
                state={state}
                title={`${rank} tile`}
                support={`rank-${rank}, state=${state}`}
              >
                <p className="text-[13px] text-ink-muted">Ready content for {rank}.</p>
              </ChartTile>
            ))}
          </BentoGrid>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="eyebrow">stat + feed samples</h2>
        <BentoGrid>
          <StatTile rank="hero" label="Present now" value={248} suffix="/ 312" tone="accent" />
          <StatTile rank="chip" label="Anomalies" value={0} tone="neutral" />
          <StatTile rank="chip" label="Anomalies" value={3} tone="rejected" />
          <FeedTile rank="tall" title="Live feed" ariaLive>
            <p className="p-4 text-[13px] text-ink-muted">Sample feed content.</p>
          </FeedTile>
        </BentoGrid>
      </section>
    </div>
  );
}
