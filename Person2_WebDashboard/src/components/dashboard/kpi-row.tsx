import { useQuery } from '@tanstack/react-query';
import { Stat } from '@/components/common/stat';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { FACE_MATCH_THRESHOLD, LATE_ARRIVAL_CUTOFF_LABEL } from '@/lib/dashboard-constants';
import type { DashboardKpis } from '@/types/api';

/**
 * The four KPI cards from wireframe Fig 3.4, in the same order:
 * Checked In Today · On Leave · Late Arrivals · Avg Face Match.
 *
 * These are invalidated by the socket hook whenever a check-in arrives, so the
 * numbers and the feed below can never disagree.
 */
export function KpiRow() {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.kpis,
    queryFn: () => fetchData<DashboardKpis>('dashboard/kpis'),
    staleTime: 10_000,
  });

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[92px]" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card px-4 py-3 text-[12.5px] text-muted">
        Today&rsquo;s totals are unavailable. They will appear once the backend responds.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Stat
        label="Checked in today"
        value={data.checkedInToday}
        tone="accent"
        footnote={`of ${data.totalEmployees} active employees`}
      />
      <Stat label="On leave" value={data.onLeave} tone="neutral" footnote="Approved absences today" />
      <Stat
        label="Late arrivals"
        value={data.lateArrivals}
        tone={data.lateArrivals > 0 ? 'flagged' : 'neutral'}
        footnote={`After ${LATE_ARRIVAL_CUTOFF_LABEL}`}
      />
      <Stat
        label="Avg face match"
        value={data.avgFaceMatch.toFixed(1)}
        suffix="%"
        tone={data.avgFaceMatch >= FACE_MATCH_THRESHOLD ? 'verified' : 'flagged'}
        footnote={`${data.flaggedToday} awaiting review`}
      />
    </div>
  );
}
