import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/states';
import { Avatar } from '@/components/ui/avatar';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { LiveMap } from '@/components/map/live-map';
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          title="On site now"
          description="Employees whose latest event today is a check-in"
          action={
            <span className="eyebrow">
              <span className="tnum text-ink">{presence?.length ?? 0}</span> present
            </span>
          }
        />
        <div className="p-4">
          {isPending ? (
            <Skeleton className="h-[540px] w-full" />
          ) : (
            <LiveMap presence={presence ?? []} geofences={geofences ?? []} />
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="By office" />
          <CardBody>
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
          </CardBody>
        </Card>

        <Card className="flex h-full flex-col">
          <CardHeader title="Present employees" />
          <div className="scrollbar-slim max-h-[380px] overflow-y-auto">
            {!presence || presence.length === 0 ? (
              <EmptyState
                title="Nobody on site"
                message="This fills as employees check in."
                icon={Users}
              />
            ) : (
              <ul>
                {presence.map((entry) => (
                  <li
                    key={entry.user_id}
                    className="flex items-center gap-2.5 border-b border-line px-4 py-2.5 last:border-b-0"
                  >
                    <Avatar name={entry.employee_name} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-ink">
                        {entry.employee_name}
                      </p>
                      <p className="tnum text-[10.5px] text-faint">
                        {formatTime(entry.timestamp)} · {entry.office_name}
                      </p>
                    </div>
                    <ConfidenceBar score={entry.face_match_score} width="w-12" showValue={false} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
