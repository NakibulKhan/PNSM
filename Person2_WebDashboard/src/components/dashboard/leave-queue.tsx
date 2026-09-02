import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, CalendarRange } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { LeaveStatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { EmptyState } from '@/components/common/states';
import { SkeletonRows } from '@/components/ui/skeleton';
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

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
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

      {isPending ? (
        <SkeletonRows rows={4} />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            title="No requests here"
            message="Leave submitted from the mobile app arrives in this queue."
            icon={CalendarRange}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((request) => (
            <Card key={request._id}>
              <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar name={request.employee_name ?? '—'} size={40} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-semibold text-ink">{request.employee_name}</p>
                    <LeaveStatusBadge status={request.status} />
                  </div>
                  <p className="tnum mt-1 text-[12px] text-muted">
                    {formatDate(request.from_date)} → {formatDate(request.to_date)} ·{' '}
                    {dayCount(request)} day{dayCount(request) > 1 ? 's' : ''}
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
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
