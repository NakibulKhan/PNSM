/**
 * Flagged check-in review queue.
 *
 * Every card answers the reviewer's real question — why did this land here? — by
 * showing the score against the threshold, the selfie, the GPS reading and the
 * distance context, so a decision can be made without leaving the screen.
 *
 * Decisions are optimistic: the row leaves the queue immediately and is restored
 * if the write fails, because on a slow link waiting for a round trip per
 * decision makes a queue of twenty unworkable.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, MapPin, Clock } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
import { TileEmpty } from '@/components/bento/TileEmpty';
import { TileSkeleton } from '@/components/bento/TileSkeleton';
import { useToast } from '@/components/ui/toast';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/tz';
import { formatLatLng, pointToLatLng } from '@/lib/geo';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import type { AttendanceLog } from '@/types/models';

export function FlaggedQueue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isPending } = useQuery({
    queryKey: ['attendance', 'flagged', 'list'],
    queryFn: () => fetchData<AttendanceLog[]>('attendance', { status: 'flagged', pageSize: 100 }),
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => {
      await api.post(`attendance/${id}/${decision}`);
      return { id, decision };
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['attendance', 'flagged', 'list'] });
      const previous = queryClient.getQueryData<AttendanceLog[]>(['attendance', 'flagged', 'list']);
      queryClient.setQueryData<AttendanceLog[]>(['attendance', 'flagged', 'list'], (rows = []) =>
        rows.filter((row) => row._id !== id),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Put the row back: a failed write must not look like a completed review.
      if (context?.previous) {
        queryClient.setQueryData(['attendance', 'flagged', 'list'], context.previous);
      }
      toast({
        tone: 'error',
        title: 'Decision not saved',
        description: 'The record is back in the queue. Try again.',
      });
    },
    onSuccess: ({ decision }) => {
      toast({
        tone: 'success',
        title: decision === 'approve' ? 'Approved' : 'Rejected',
        description: 'The attendance record has been updated.',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flagged });
      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
      queryClient.invalidateQueries({ queryKey: ['attendance', 'list'] });
    },
  });

  const state = isPending ? 'loading' : !data || data.length === 0 ? 'empty' : 'ready';

  return (
    <BentoGrid>
      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title="Review queue"
          support={data ? `${data.length} awaiting a decision` : undefined}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state === 'loading' ? (
            <TileSkeleton />
          ) : state === 'empty' ? (
            <TileEmpty
              title="Nothing waiting for review"
              message={`Check-ins scoring below ${FACE_MATCH_THRESHOLD}% arrive here for a manual decision.`}
            />
          ) : (
            <div className="space-y-3">
              {data!.map((log) => {
                const point = pointToLatLng(log.gps_location);
                const shortfall = FACE_MATCH_THRESHOLD - log.face_match_score;
                const busy = decide.isPending && decide.variables?.id === log._id;

                return (
                  <div key={log._id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <Avatar name={log.employee_name ?? '—'} src={log.selfie_url} size={52} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-semibold text-ink">{log.employee_name}</p>
                        <span className="tnum text-[11.5px] text-faint">{log.employee_code}</span>
                        {log.mock_location_detected ? <Badge tone="rejected">Spoofed GPS</Badge> : null}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
                        <span className="flex items-center gap-1">
                          <Clock size={12} aria-hidden />
                          <span className="tnum">{formatDateTime(log.timestamp)}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin size={12} aria-hidden />
                          {log.office_name}
                        </span>
                        <span className="tnum text-faint">
                          {point ? formatLatLng(point.lat, point.lng) : 'Location unavailable'}
                        </span>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-3">
                        <ConfidenceBar score={log.face_match_score} width="w-32" />
                        <span className="tnum text-[11.5px] text-flagged">
                          {shortfall.toFixed(1)} points below the {FACE_MATCH_THRESHOLD}% threshold
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy && decide.variables?.decision === 'reject'}
                        onClick={() => decide.mutate({ id: log._id, decision: 'reject' })}
                      >
                        <X size={13} aria-hidden /> Reject
                      </Button>
                      <Button
                        variant="success"
                        size="sm"
                        loading={busy && decide.variables?.decision === 'approve'}
                        onClick={() => decide.mutate({ id: log._id, decision: 'approve' })}
                      >
                        <Check size={13} aria-hidden /> Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </BentoTile>
    </BentoGrid>
  );
}
