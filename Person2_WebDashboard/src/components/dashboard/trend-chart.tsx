/**
 * Attendance Trend (7 days) — wireframe Fig 3.4.
 *
 * Recharts is code-split with React.lazy + Suspense. It is a large dependency
 * that only one screen needs, so keeping it out of the entry chunk measurably
 * improves first paint — which matters because Vite ships this as a single-page
 * bundle with no server-rendered shell to look at while it loads.
 */
import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/states';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { TrendPoint } from '@/types/api';

const TrendBars = lazy(() =>
  import('./trend-bars').then((module) => ({ default: module.TrendBars })),
);

export function TrendChart({ days = 7 }: { days?: number }) {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.trend(days),
    queryFn: () => fetchData<TrendPoint[]>('dashboard/trend', { days }),
    staleTime: 60_000,
  });

  const peak = data?.reduce((max, point) => Math.max(max, point.count), 0) ?? 0;

  return (
    <Card>
      <CardHeader
        title={`Attendance trend (${days} days)`}
        description="Unique employees checked in per day, Asia/Dhaka calendar days"
        action={
          peak > 0 ? (
            <span className="eyebrow">
              peak <span className="tnum text-ink">{peak}</span>
            </span>
          ) : null
        }
      />
      <div className="p-4">
        {isPending ? (
          <Skeleton className="h-[200px] w-full" />
        ) : isError || !data || data.length === 0 ? (
          <EmptyState title="No trend data" message="The chart draws once attendance is recorded." />
        ) : (
          <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
            <TrendBars data={data} />
          </Suspense>
        )}
      </div>
    </Card>
  );
}
