import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BentoTile, useTileHeading } from '@/components/bento/BentoTile';
import { TileSkeleton } from '@/components/bento/TileSkeleton';
import { TileError } from '@/components/bento/TileError';
import { WakingState } from '@/components/common/states';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchData, isBackendWaking } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { DashboardKpis } from '@/types/api';
import type { TrendPoint } from '@/types/api';

const TrendBars = lazy(() =>
  import('./trend-bars').then((module) => ({ default: module.TrendBars })),
);

/**
 * The hero tile — "the one question the screen answers" (master prompt §3
 * rule 3). Combines the headcount numeral (`GET /dashboard/kpis`) with the
 * 7-day trend (`GET /dashboard/trend?days=7`, under `queryKeys.trend(7)` —
 * the pre-Bento `TrendChart` component that used to fetch this separately was
 * deleted once this tile absorbed it, so this is the only consumer now)
 * rather than splitting them into two tiles, since together they answer the
 * one question in one glance.
 */
export function PresentNowTile() {
  const kpis = useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => fetchData<DashboardKpis>('dashboard/kpis'),
    staleTime: 10_000,
  });
  const trend = useQuery({
    queryKey: queryKeys.trend(7),
    queryFn: () => fetchData<TrendPoint[]>('dashboard/trend', { days: 7 }),
    staleTime: 60_000,
  });

  const state = kpis.isPending ? 'loading' : kpis.isError || !kpis.data ? 'error' : 'ready';

  return (
    <BentoTile rank="hero" state={state}>
      {state === 'loading' ? (
        <TileSkeleton />
      ) : state === 'error' ? (
        // The hero tile is the first thing a page load shows, and this app's
        // free-tier backend really does cold-sleep — a real ECONNABORTED here
        // reads as "the whole dashboard is broken" unless it's told apart
        // from a genuine failure. Big enough (rank="hero", 3 grid rows) for
        // WakingState's full copy to fit, unlike the chip tiles beside it.
        isBackendWaking(kpis.error) ? (
          <WakingState className="h-full" />
        ) : (
          <TileError title="Present-now count unavailable" />
        )
      ) : (
        <PresentNowBody
          checkedInToday={kpis.data!.checkedInToday}
          totalEmployees={kpis.data!.totalEmployees}
          trend={trend}
        />
      )}
    </BentoTile>
  );
}

function PresentNowBody({
  checkedInToday,
  totalEmployees,
  trend,
}: {
  checkedInToday: number;
  totalEmployees: number;
  trend: ReturnType<typeof useQuery<TrendPoint[]>>;
}) {
  // M1: this used to destructure only `id` and render a plain `<p>` — this is
  // the hero tile, so it's specifically the missing <h2> (the dashboard's
  // outline jumped h1 straight to h3 everywhere else on the page).
  const { id, level: Level } = useTileHeading();

  return (
    <div className="flex h-full flex-col p-4">
      <Level id={id} className="eyebrow">
        Present now
      </Level>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="tnum text-[64px] font-light leading-none text-ink">{checkedInToday}</span>
        <span className="tnum text-[18px] font-semibold text-ink-muted">/ {totalEmployees}</span>
      </p>
      <div className="mt-2 min-h-0 flex-1">
        {trend.isPending ? (
          <Skeleton className="h-full w-full" />
        ) : trend.isError || !trend.data || trend.data.length === 0 ? (
          <p className="text-[12.5px] text-ink-faint">Trend draws once attendance is recorded.</p>
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TrendBars data={trend.data} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
