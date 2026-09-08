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
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { TableShell, Td, Th, Tr } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/common/states';
import { PhotoUpload } from '@/components/forms/photo-upload';
import { RbacGate } from '@/components/common/rbac-gate';
import { useToast } from '@/components/ui/toast';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
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
      <div className="split-grid grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="split-aside h-[320px]" />
        <Skeleton className="split-main h-[320px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="card">
        <ErrorState message="That employee record could not be loaded. It may have been removed." />
      </div>
    );
  }

  const averageMatch =
    data.recent_logs.length > 0
      ? data.recent_logs.reduce((sum, log) => sum + log.face_match_score, 0) / data.recent_logs.length
      : null;

  return (
    <BentoGrid>
      <BentoTile rank="hero">
        <TileHeader title={data.name} support={data.employee_code} />
        <div className="flex flex-1 flex-col p-4 pt-0">
          <div className="flex items-start gap-4">
            <Avatar name={data.name} src={data.reference_photo_url} size={64} />
            <div className="flex flex-wrap gap-1.5 pt-1">
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
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-hairline pt-4 sm:grid-cols-2">
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
              ['Embedding model', data.face_embedding_meta?.model_version ?? '—'],
              [
                'Biometric storage',
                data.has_face_embedding ? 'Isolated collection, AES-256-GCM encrypted' : '—',
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <dt className="eyebrow shrink-0 pt-0.5">{label}</dt>
                <dd className="min-w-0 break-words text-right text-[12px] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </BentoTile>

      <RbacGate permission="employee:write">
        <BentoTile rank="square">
          <TileHeader
            title="Reference photo"
            support="Replace it if matching accuracy has drifted."
            action={
              !replacing ? (
                <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
                  <RefreshCcw size={13} aria-hidden /> Replace
                </Button>
              ) : null
            }
          />
          {replacing ? (
            <div className="p-4 pt-0">
              <PhotoUpload
                value={null}
                onChange={(url) => {
                  if (url) updatePhoto.mutate(url);
                }}
              />
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            </div>
          ) : null}
        </BentoTile>
      </RbacGate>

      <RbacGate permission="employee:deactivate">
        {data.is_active !== false ? (
          <BentoTile rank="square">
            <div className="flex flex-1 flex-col p-4">
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
            </div>
          </BentoTile>
        ) : null}
      </RbacGate>

      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title="Attendance history"
          support="Most recent events first"
          action={
            averageMatch !== null ? (
              <div className="flex items-center gap-2">
                <span className="eyebrow">avg match</span>
                <ConfidenceBar score={averageMatch} width="w-20" />
              </div>
            ) : null
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
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
        </div>
      </BentoTile>
    </BentoGrid>
  );
}
