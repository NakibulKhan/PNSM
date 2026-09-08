import { useQuery } from '@tanstack/react-query';
import { StatTile } from '@/components/bento/StatTile';
import { fetchData } from '@/api/client';
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
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => fetchData<DashboardKpis>('dashboard/kpis'),
    staleTime: 10_000,
  });

  const state = isPending ? 'loading' : isError || !data ? 'error' : 'ready';

  return (
    <>
      <StatTile
        rank="chip"
        state={state}
        label="Late arrivals"
        value={data?.lateArrivals ?? 0}
        tone={data && data.lateArrivals > 0 ? 'flagged' : 'neutral'}
        footnote={`After ${LATE_ARRIVAL_CUTOFF_LABEL}`}
      />
      <StatTile
        rank="chip"
        state={state}
        label="On leave"
        value={data?.onLeave ?? 0}
        tone="neutral"
        footnote="Approved absences today"
      />
      <StatTile
        rank="chip"
        state={state}
        label="Avg face match"
        value={data ? data.avgFaceMatch.toFixed(1) : '—'}
        suffix="%"
        tone={data && data.avgFaceMatch >= FACE_MATCH_THRESHOLD ? 'verified' : 'flagged'}
        footnote={data ? `${data.flaggedToday} awaiting review` : undefined}
      />
    </>
  );
}
