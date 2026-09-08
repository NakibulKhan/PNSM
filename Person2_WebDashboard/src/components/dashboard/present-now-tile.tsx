import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BentoTile, useTileHeading } from '@/components/bento/BentoTile';
import { TileSkeleton } from '@/components/bento/TileSkeleton';
import { TileError } from '@/components/bento/TileError';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { DashboardKpis } from '@/types/api';
import type { TrendPoint } from '@/types/api';

const TrendBars = lazy(() =>
  import('./trend-bars').then((module) => ({ default: module.TrendBars })),
);

/**
 * The hero tile — "the one question the screen answers" (master prompt §3
 * rule 3). Combines the headcount numeral (`GET /dashboard/kpis`) with the
 * 7-day trend (`GET /dashboard/trend?days=7`, the same query key `TrendChart`
 * used, so the cache is shared) rather than splitting them into two tiles,
 * since together they answer the one question in one glance.
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
        <TileError title="Present-now count unavailable" />
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
  const { id } = useTileHeading();

  return (
    <div className="flex h-full flex-col p-4">
      <p id={id} className="eyebrow">
        Present now
      </p>
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
