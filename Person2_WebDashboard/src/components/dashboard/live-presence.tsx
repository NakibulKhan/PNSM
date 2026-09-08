import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { LiveMap } from '@/components/map/live-map';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { MapTile } from '@/components/bento/MapTile';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
import { TileEmpty } from '@/components/bento/TileEmpty';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatTime } from '@/lib/tz';
import type { Geofence } from '@/types/models';
import type { LivePresence } from '@/types/live';

/**
 * Live workforce distribution. Refetched on an interval as well as on socket
 * events, because a check-out elsewhere changes who is on site without
 * generating a check-in event on this screen.
 */
export function LivePresenceView() {
  const { data: presence, isPending } = useQuery({
    queryKey: queryKeys.liveMap,
    queryFn: () => fetchData<LivePresence[]>('attendance/live-map'),
    refetchInterval: 30_000,
  });

  const { data: geofences } = useQuery({
    queryKey: queryKeys.geofences,
    queryFn: () => fetchData<Geofence[]>('geofences'),
    staleTime: 5 * 60_000,
  });

  const byOffice = (presence ?? []).reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.office_name] = (accumulator[entry.office_name] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <BentoGrid>
      <MapTile
        rank="wide"
        span="bento-span-tall"
        state={isPending ? 'loading' : 'ready'}
        title="On site now"
        support="Employees whose latest event today is a check-in"
        action={
          <span className="eyebrow">
            <span className="tnum text-ink">{presence?.length ?? 0}</span> present
          </span>
        }
      >
        {isPending ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <LiveMap presence={presence ?? []} geofences={geofences ?? []} heightClass="h-full" />
        )}
      </MapTile>

      <BentoTile rank="square">
        <TileHeader title="By office" />
        <div className="flex-1 p-4 pt-2">
          {Object.keys(byOffice).length === 0 ? (
            <p className="text-[12.5px] text-muted">No one is checked in right now.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(byOffice).map(([office, count]) => (
                <li key={office} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] text-ink">{office}</span>
                  <span className="tnum text-[13px] font-semibold text-accent">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </BentoTile>

      <BentoTile rank="tall">
        <TileHeader title="Present employees" />
        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
          {!presence || presence.length === 0 ? (
            <TileEmpty title="Nobody on site" message="This fills as employees check in." />
          ) : (
            <ul>
              {presence.map((entry) => (
                <li
                  key={entry.user_id}
                  className="flex items-center gap-2.5 border-b border-hairline px-4 py-2.5 last:border-b-0"
                >
                  <Avatar name={entry.employee_name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink">
                      {entry.employee_name}
                    </p>
                    <p className="tnum flex flex-wrap gap-x-1.5 text-[10.5px] text-faint">
                      <span>{formatTime(entry.timestamp)}</span>
                      <span>{entry.office_name}</span>
                    </p>
                  </div>
                  <ConfidenceBar score={entry.face_match_score} width="w-12" showValue={false} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </BentoTile>
    </BentoGrid>
  );
}
