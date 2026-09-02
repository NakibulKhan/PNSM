import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfidenceBar, ConfidenceLegend } from '@/components/ui/confidence-bar';
import { EmptyState } from '@/components/common/states';
import { SkeletonRows } from '@/components/ui/skeleton';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatTime } from '@/lib/tz';
import { cn } from '@/lib/utils';
import type { AttendanceLog } from '@/types/models';

/**
 * Live Check-In Feed (wireframe Fig 3.4).
 *
 * Rows are keyed by `_id`, which is also how the socket hook deduplicates, so a
 * reconnect that replays events cannot produce a doubled row. Newly arrived rows
 * animate once with an accent rule — the only motion in the product, so it
 * always means "this just happened".
 */
export function LiveFeed() {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.feed,
    queryFn: () => fetchData<AttendanceLog[]>('attendance/feed', { limit: 15 }),
    staleTime: 5_000,
  });

  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const incoming = data.filter((log) => !seen.current.has(log._id)).map((log) => log._id);
    // First load should not animate every row; only subsequent arrivals do.
    const isFirstLoad = seen.current.size === 0;
    data.forEach((log) => seen.current.add(log._id));
    if (isFirstLoad || incoming.length === 0) return;
    setFresh(new Set(incoming));
    const timer = setTimeout(() => setFresh(new Set()), 1_300);
    return () => clearTimeout(timer);
  }, [data]);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Live check-in feed"
        description="Newest first, as check-ins arrive from the mobile app"
        action={
          <Link
            to="/attendance"
            className="text-[12px] font-semibold text-accent hover:text-accent-dark"
          >
            All logs
          </Link>
        }
      />

      <div className="scrollbar-slim max-h-[420px] min-h-[220px] flex-1 overflow-y-auto">
        {isPending ? (
          <SkeletonRows rows={6} className="p-4" />
        ) : isError ? (
          <EmptyState
            title="Feed unavailable"
            message="Check-ins will stream in as soon as the connection returns."
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="No check-ins yet"
            message="The feed fills as employees check in from the mobile app."
          />
        ) : (
          <ul>
            {data.map((log) => (
              <li
                key={log._id}
                className={cn(
                  'flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0',
                  fresh.has(log._id) && 'feed-arrive',
                )}
              >
                <Avatar name={log.employee_name ?? 'Unknown'} src={log.selfie_url} size={30} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {log.employee_name ?? 'Unknown employee'}
                  </p>
                  <p className="truncate text-[11.5px] text-muted">
                    <span className="tnum">{log.employee_code}</span>
                    {log.employee_code ? ' · ' : ''}
                    {log.office_name}
                    {log.check_type === 'check_out' ? ' · check out' : ''}
                  </p>
                </div>

                <span className="tnum hidden shrink-0 text-[12px] text-muted sm:block">
                  {formatTime(log.timestamp)}
                </span>

                <ConfidenceBar score={log.face_match_score} width="w-16 sm:w-20" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-line px-4 py-2">
        <ConfidenceLegend />
      </div>
    </Card>
  );
}
