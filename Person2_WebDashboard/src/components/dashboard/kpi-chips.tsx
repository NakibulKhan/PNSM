import { useQuery } from '@tanstack/react-query';
import { StatTile } from '@/components/bento/StatTile';
import { fetchData, isBackendWaking } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { FACE_MATCH_THRESHOLD, LATE_ARRIVAL_CUTOFF_LABEL } from '@/lib/dashboard-constants';
import type { DashboardKpis } from '@/types/api';

/**
 * Three `chip`-rank tiles alongside the hero (master prompt §3 rule 2: at
 * least three distinct tile ranks per screen). Shares `queryKeys.kpis` with
 * `PresentNowTile` — TanStack Query dedupes the request, this fires no
 * second call.
 */
export function KpiChips() {
  const { data, error, isPending, isError } = useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => fetchData<DashboardKpis>('dashboard/kpis'),
    staleTime: 10_000,
  });

  const state = isPending ? 'loading' : isError || !data ? 'error' : 'ready';
  // Same query PresentNowTile reads (queryKeys.kpis is shared, TanStack Query
  // dedupes it) — these chips fail together with the hero tile on a cold
  // backend, so they get the same waking-aware copy, just sized for a chip.
  const errorProps = isBackendWaking(error)
    ? { errorTitle: 'Waking up', errorMessage: 'Free-tier backend starting — fills in shortly.', errorWaking: true }
    : {};

  return (
    <>
      <StatTile
        rank="chip"
        state={state}
        label="Late arrivals"
        value={data?.lateArrivals ?? 0}
        tone={data && data.lateArrivals > 0 ? 'flagged' : 'neutral'}
        footnote={`After ${LATE_ARRIVAL_CUTOFF_LABEL}`}
        {...errorProps}
      />
      <StatTile
        rank="chip"
        state={state}
        label="On leave"
        value={data?.onLeave ?? 0}
        tone="neutral"
        footnote="Approved absences today"
        {...errorProps}
      />
      <StatTile
        rank="chip"
        state={state}
        label="Avg face match"
        // `.toFixed(1)` used to be here, but GET /dashboard/kpis already
        // rounds this to a whole number (dashboardService.ts's Math.round) —
        // rendering it with one decimal place manufactured a fake ".0" that
        // implies precision the value never had.
        value={data ? data.avgFaceMatch : '—'}
        suffix="%"
        tone={data && data.avgFaceMatch >= FACE_MATCH_THRESHOLD ? 'verified' : 'flagged'}
        footnote={data ? `${data.flaggedToday} awaiting review` : undefined}
        {...errorProps}
      />
    </>
  );
}
