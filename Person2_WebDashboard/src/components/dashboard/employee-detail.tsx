/**
 * Employee profile: identity, biometric baseline, assigned geofence and history.
 * Also the place HR replaces a reference photo when matching accuracy drifts.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, ShieldOff } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { TableShell, Td, Th, Tr } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/common/states';
import { PhotoUpload } from '@/components/forms/photo-upload';
import { RbacGate } from '@/components/common/rbac-gate';
import { useToast } from '@/components/ui/toast';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, formatTime } from '@/lib/tz';
import { checkTypeLabel } from '@/lib/format';
import type { AttendanceLog, Shift, User } from '@/types/models';

interface EmployeeDetail extends User {
  office_name?: string;
  shift: Shift | null;
  recent_logs: AttendanceLog[];
}

export function EmployeeDetailView({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [replacing, setReplacing] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.employee(employeeId),
    queryFn: () => fetchData<EmployeeDetail>(`employees/${employeeId}`),
  });

  const updatePhoto = useMutation({
    mutationFn: (url: string) => api.patch(`employees/${employeeId}/photo`, { reference_photo_url: url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.employee(employeeId) });
      setReplacing(false);
      toast({
        tone: 'success',
        title: 'Reference photo updated',
        description: 'A new biometric baseline has been generated.',
      });
    },
    onError: () => toast({ tone: 'error', title: 'Photo not updated', description: 'Try again.' }),
  });

  const deactivate = useMutation({
    mutationFn: () => api.delete(`employees/${employeeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.employee(employeeId) });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast({
        tone: 'success',
        title: 'Account deactivated',
        description: 'This employee can no longer check in.',
      });
    },
  });

  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="h-[320px]" />
        <Skeleton className="h-[320px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <ErrorState message="That employee record could not be loaded. It may have been removed." />
      </Card>
    );
  }

  const averageMatch =
    data.recent_logs.length > 0
      ? data.recent_logs.reduce((sum, log) => sum + log.face_match_score, 0) / data.recent_logs.length
      : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardBody className="text-center">
            <div className="flex justify-center">
              <Avatar name={data.name} src={data.reference_photo_url} size={84} />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-ink">{data.name}</p>
            <p className="tnum text-[11.5px] text-faint">{data.employee_code}</p>

            <div className="mt-2 flex justify-center gap-1.5">
              {data.is_active === false ? (
                <Badge tone="rejected">Deactivated</Badge>
              ) : (
                <Badge tone="verified">Active</Badge>
              )}
              {data.has_face_embedding ? (
                <Badge tone="accent">Baseline enrolled</Badge>
              ) : (
                <Badge tone="flagged">No baseline</Badge>
              )}
            </div>

            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-left">
              {[
                ['Department', data.department ?? '—'],
                ['Assigned office', data.office_name ?? '—'],
                ['Email', data.email],
                ['Mobile', data.phone],
                [
                  'Shift',
                  data.shift ? `${data.shift.start_time} – ${data.shift.end_time} (${data.shift.days_of_week})` : '—',
                ],
                ['Onboarded', formatDate(data.created_at)],
                ['Embedding model', data.face_embedding_meta?.model_version ?? '\u2014'],
                [
                  'Biometric storage',
                  data.has_face_embedding
                    ? 'Isolated collection, AES-256-GCM encrypted'
                    : '\u2014',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <dt className="eyebrow shrink-0 pt-0.5">{label}</dt>
                  <dd className="min-w-0 break-words text-right text-[12px] text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <RbacGate permission="employee:write">
          <Card>
            <CardHeader
              title="Reference photo"
              description="Replace it if matching accuracy has drifted."
              action={
                !replacing ? (
                  <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
                    <RefreshCcw size={13} aria-hidden /> Replace
                  </Button>
                ) : null
              }
            />
            {replacing ? (
              <CardBody>
                <PhotoUpload
                  value={null}
                  onChange={(url) => {
                    if (url) updatePhoto.mutate(url);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setReplacing(false)}
                >
                  Cancel
                </Button>
              </CardBody>
            ) : null}
          </Card>
        </RbacGate>

        <RbacGate permission="employee:deactivate">
          {data.is_active !== false ? (
            <Card>
              <CardBody>
                <p className="eyebrow mb-1">Access</p>
                <p className="mb-2.5 text-[11.5px] text-muted">
                  Deactivating keeps the attendance history and blocks future check-ins.
                </p>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deactivate.isPending}
                  onClick={() => deactivate.mutate()}
                >
                  <ShieldOff size={13} aria-hidden /> Deactivate account
                </Button>
              </CardBody>
            </Card>
          ) : null}
        </RbacGate>
      </div>

      <Card>
        <CardHeader
          title="Attendance history"
          description="Most recent events first"
          action={
            averageMatch !== null ? (
              <div className="flex items-center gap-2">
                <span className="eyebrow">avg match</span>
                <ConfidenceBar score={averageMatch} width="w-20" />
              </div>
            ) : null
          }
        />

        {data.recent_logs.length === 0 ? (
          <EmptyState
            title="No check-ins recorded"
            message="History appears once this employee checks in from the mobile app."
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Type</Th>
                <Th>Office</Th>
                <Th align="right">Face match</Th>
              </tr>
            </thead>
            <tbody>
              {data.recent_logs.map((log) => (
                <Tr key={log._id}>
                  <Td className="tnum">{formatDate(log.timestamp)}</Td>
                  <Td className="tnum">{formatTime(log.timestamp)}</Td>
                  <Td>
                    <Badge tone={log.check_type === 'check_in' ? 'accent' : 'neutral'}>
                      {checkTypeLabel(log.check_type)}
                    </Badge>
                  </Td>
                  <Td className="text-muted">{log.office_name}</Td>
                  <Td align="right">
                    <div className="flex justify-end">
                      <ConfidenceBar score={log.face_match_score} width="w-16" />
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
