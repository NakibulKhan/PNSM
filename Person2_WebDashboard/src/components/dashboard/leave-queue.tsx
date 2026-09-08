import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { LeaveStatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile, useTileHeading } from '@/components/bento/BentoTile';
import { TileSkeleton } from '@/components/bento/TileSkeleton';
import { TileEmpty } from '@/components/bento/TileEmpty';
import { RbacGate } from '@/components/common/rbac-gate';
import { useToast } from '@/components/ui/toast';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatDate } from '@/lib/tz';
import type { LeaveRequest } from '@/types/models';

/** Leave approvals. Approved absences feed the "On leave" KPI on the dashboard. */
export function LeaveQueue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState('pending');

  const { data, isPending } = useQuery({
    queryKey: ['leave', 'list', status],
    queryFn: () => fetchData<LeaveRequest[]>('leave', { status }),
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => {
      await api.post(`leave/${id}/${decision}`);
      return decision;
    },
    onSuccess: (decision) => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
      toast({
        tone: 'success',
        title: decision === 'approve' ? 'Leave approved' : 'Leave rejected',
        description: 'The attendance record will reflect this decision.',
      });
    },
    onError: () =>
      toast({ tone: 'error', title: 'Decision not saved', description: 'Try again in a moment.' }),
  });

  const dayCount = (request: LeaveRequest) =>
    Math.max(
      1,
      Math.round(
        (new Date(request.to_date).getTime() - new Date(request.from_date).getTime()) / 86_400_000,
      ) + 1,
    );

  const state = isPending ? 'loading' : !data || data.length === 0 ? 'empty' : 'ready';

  return (
    <BentoGrid>
      <BentoTile rank="rail">
        <RailHeading />
        <div className="flex items-center gap-2 p-4">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-auto min-w-[170px]"
            aria-label="Filter leave requests"
          >
            <option value="pending">Pending decision</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All requests</option>
          </Select>
        </div>
      </BentoTile>

      <BentoTile rank="wide" span="bento-span-tall">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state === 'loading' ? (
            <TileSkeleton />
          ) : state === 'empty' ? (
            <TileEmpty
              title="No requests here"
              message="Leave submitted from the mobile app arrives in this queue."
            />
          ) : (
            <div className="space-y-3">
              {data!.map((request) => (
                <div key={request._id} className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                  <Avatar name={request.employee_name ?? '—'} size={40} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink">{request.employee_name}</p>
                      <LeaveStatusBadge status={request.status} />
                    </div>
                    <p className="tnum mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                      <span>
                        {formatDate(request.from_date)} → {formatDate(request.to_date)}
                      </span>
                      <span>
                        {dayCount(request)} day{dayCount(request) > 1 ? 's' : ''}
                      </span>
                    </p>
                    <p className="mt-1 text-[12px] text-muted">{request.reason}</p>
                  </div>

                  {request.status === 'pending' ? (
                    <RbacGate permission="leave:write">
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => decide.mutate({ id: request._id, decision: 'reject' })}
                        >
                          <X size={13} aria-hidden /> Reject
                        </Button>
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => decide.mutate({ id: request._id, decision: 'approve' })}
                        >
                          <Check size={13} aria-hidden /> Approve
                        </Button>
                      </div>
                    </RbacGate>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </BentoTile>
    </BentoGrid>
  );
}

/** A rail tile is just a filter bar, but every tile still needs its own accessible name (§10). */
function RailHeading() {
  const { id } = useTileHeading();
  return (
    <h3 id={id} className="sr-only">
      Filter leave requests
    </h3>
  );
}
