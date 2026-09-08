import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/avatar';
import { ConfidenceBar, ConfidenceLegend } from '@/components/ui/confidence-bar';
import { FeedTile } from '@/components/bento/FeedTile';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatTime } from '@/lib/tz';
import { cn } from '@/lib/utils';
import type { AttendanceLog } from '@/types/models';

/**
 * Live check-in feed, re-housed in a `FeedTile`. Query/dedup/animation logic
 * is unchanged from the pre-Bento `LiveFeed` component (same query key, same
 * `_id`-keyed dedup, same `feed-arrive` motion — the network contract and the
 * live-updates behaviour are untouched). Only the meta line's presentation
 * changed: the old `code · office · check out` middle-dot join is one of the
 * master prompt's explicitly banned patterns (§3); replaced with spaced
 * fields and a small tag, same information, no joiner glyph.
 */
export function LiveFeedTile() {
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
    const isFirstLoad = seen.current.size === 0;
    data.forEach((log) => seen.current.add(log._id));
    if (isFirstLoad || incoming.length === 0) return;
    setFresh(new Set(incoming));
    const timer = setTimeout(() => setFresh(new Set()), 1_300);
    return () => clearTimeout(timer);
  }, [data]);

  const state = isPending ? 'loading' : isError ? 'error' : !data || data.length === 0 ? 'empty' : 'ready';

  return (
    <FeedTile
      rank="tall"
      state={state}
      title="Live check-in feed"
      support="Newest first, as check-ins arrive from the mobile app"
      action={
        <Link to="/attendance" className="text-[12px] font-semibold text-accent hover:text-accent-dark">
          All logs
        </Link>
      }
      footer={<ConfidenceLegend />}
      emptyTitle="No check-ins yet"
      emptyMessage="The feed fills as employees check in from the mobile app."
      ariaLive
    >
      <ul>
        {(data ?? []).map((log) => (
          <li
            key={log._id}
            className={cn(
              'flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0',
              fresh.has(log._id) && 'feed-arrive',
            )}
          >
            <Avatar name={log.employee_name ?? 'Unknown'} src={log.selfie_url} size={30} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">
                {log.employee_name ?? 'Unknown employee'}
              </p>
              <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
                {log.employee_code ? <span className="tnum shrink-0">{log.employee_code}</span> : null}
                <span className="truncate">{log.office_name}</span>
                {log.check_type === 'check_out' ? (
                  <span className="shrink-0 rounded-full bg-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                    Check out
                  </span>
                ) : null}
              </p>
            </div>

            <span className="tnum hidden shrink-0 text-[12px] text-ink-muted sm:block">
              {formatTime(log.timestamp)}
            </span>

            <ConfidenceBar score={log.face_match_score} width="w-16 sm:w-20" />
          </li>
        ))}
      </ul>
    </FeedTile>
  );
}
