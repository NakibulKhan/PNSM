/** Super Admin screens: admin accounts, global policy, audit log, billing. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { TableShell, Td, Th, Tr } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/states';
import { Stat } from '@/components/common/stat';
import { useToast } from '@/components/ui/toast';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatDateTime } from '@/lib/tz';
import { toRoleKey, ROLE_LABEL } from '@/lib/rbac';
import { exportGenericCsv } from '@/lib/export-csv';
import {
  MAX_GEOFENCE_RADIUS,
  MIN_GEOFENCE_RADIUS,
} from '@/lib/constants';
import type { AuditLogEntry, User } from '@/types/models';

// ------------------------------------------------------------- admins -------
export function AdminAccountsView() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.admins,
    queryFn: () => fetchData<User[]>('admins'),
  });

  if (isPending) return <SkeletonRows rows={4} />;

  return (
    <Card>
      <CardHeader
        title="Admin accounts"
        description="Accounts that can sign in to this console"
        action={<span className="eyebrow"><span className="tnum text-ink">{data?.length ?? 0}</span> accounts</span>}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th align="right">Status</Th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((admin) => (
            <Tr key={admin._id}>
              <Td>
                <div className="flex items-center gap-2.5">
                  <Avatar name={admin.name} src={admin.reference_photo_url} size={28} />
                  <span className="text-[13px] font-semibold text-ink">{admin.name}</span>
                </div>
              </Td>
              <Td className="text-muted">{admin.email}</Td>
              <Td>
                <Badge tone={admin.role_name === 'Super Admin' ? 'accent' : 'neutral'}>
                  {ROLE_LABEL[toRoleKey(admin.role_name ?? 'Employee')]}
                </Badge>
              </Td>
              <Td align="right">
                {admin.is_active === false ? (
                  <Badge tone="rejected">Deactivated</Badge>
                ) : (
                  <Badge tone="verified">Active</Badge>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </Card>
  );
}

// ------------------------------------------------------------- policy -------
interface Policy {
  face_match_threshold: number;
  default_radius_meters: number;
  late_arrival_cutoff: string;
  block_mock_location: boolean;
}

export function PolicyView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Policy | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['policy'],
    queryFn: () => fetchData<Policy>('policy'),
  });

  const policy = draft ?? data;

  const save = useMutation({
    mutationFn: (values: Policy) => api.patch('policy', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy'] });
      toast({
        tone: 'success',
        title: 'Policy saved',
        description: 'New check-ins are evaluated against these rules.',
      });
    },
    onError: () => toast({ tone: 'error', title: 'Policy not saved', description: 'Try again.' }),
  });

  if (isPending || !policy) return <SkeletonRows rows={4} />;

  const update = (patch: Partial<Policy>) => setDraft({ ...policy, ...patch });

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Global verification policy"
        description="Applies company-wide unless an office overrides it."
      />
      <CardBody className="space-y-5">
        <div>
          <span className="eyebrow mb-1.5 block">
            Face-match auto-approval threshold{' '}
            <span className="tnum text-ink">{policy.face_match_threshold}%</span>
          </span>
          <Slider
            value={policy.face_match_threshold}
            min={50}
            max={99}
            onValueChange={(value) => update({ face_match_threshold: value })}
            aria-label="Face-match threshold percentage"
          />
          <p className="mt-1 text-[11.5px] text-faint">
            Raising this sends more check-ins to manual review; lowering it accepts weaker matches.
          </p>
        </div>

        <div>
          <span className="eyebrow mb-1.5 block">
            Default geofence radius{' '}
            <span className="tnum text-ink">{policy.default_radius_meters} m</span>
          </span>
          <Slider
            value={policy.default_radius_meters}
            min={MIN_GEOFENCE_RADIUS}
            max={MAX_GEOFENCE_RADIUS}
            step={5}
            onValueChange={(value) => update({ default_radius_meters: value })}
            aria-label="Default geofence radius in metres"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Late arrival after" hint="Dhaka wall-clock time">
            <Input
              type="time"
              numeric
              value={policy.late_arrival_cutoff}
              onChange={(event) => update({ late_arrival_cutoff: event.target.value })}
            />
          </Field>

          <Field label="Mock-location check-ins">
            <Select
              value={policy.block_mock_location ? 'block' : 'allow'}
              onChange={(event) => update({ block_mock_location: event.target.value === 'block' })}
            >
              <option value="block">Block and alert HR</option>
              <option value="allow">Allow but flag</option>
            </Select>
          </Field>
        </div>
      </CardBody>
      <CardFooter className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate(policy)}>
          <Save size={14} aria-hidden /> Save policy
        </Button>
      </CardFooter>
    </Card>
  );
}

// -------------------------------------------------------------- audit -------
export function AuditView() {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.audit,
    queryFn: () => fetchData<AuditLogEntry[]>('audit'),
  });

  const exportAudit = () => {
    exportGenericCsv(
      (data ?? []).map((entry) => ({
        When: formatDateTime(entry.created_at),
        Actor: entry.actor_name ?? entry.actor_id,
        Action: entry.action,
        Target: entry.target,
      })),
      'pnsm-audit-log.csv',
    );
  };

  if (isPending) return <SkeletonRows rows={6} />;

  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Administrative actions across the platform"
        action={
          <Button variant="secondary" size="sm" onClick={exportAudit}>
            Export CSV
          </Button>
        }
      />
      {!data || data.length === 0 ? (
        <EmptyState title="No actions recorded" message="Administrative changes appear here." />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <Tr key={entry._id}>
                <Td className="tnum whitespace-nowrap text-muted">{formatDateTime(entry.created_at)}</Td>
                <Td className="font-semibold text-ink">{entry.actor_name}</Td>
                <Td>{entry.action}</Td>
                <Td className="tnum text-muted">{entry.target}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ billing -------
interface Billing {
  plan: string;
  seats: number;
  monthly_cost_bdt: number;
  renewal_date: string;
  components: { name: string; cost: number; note: string }[];
}

export function BillingView() {
  const { data, isPending } = useQuery({
    queryKey: ['billing'],
    queryFn: () => fetchData<Billing>('billing'),
  });

  if (isPending || !data) return <SkeletonRows rows={4} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Stat label="Current plan" value={data.plan} tone="accent" />
        <Stat label="Seats in use" value={data.seats} footnote="Active employee profiles" />
        <Stat
          label="Monthly cost"
          value={data.monthly_cost_bdt.toLocaleString('en-US')}
          suffix="BDT"
          tone="verified"
          footnote={`Renews ${data.renewal_date}`}
        />
      </div>

      <Card>
        <CardHeader
          title="Infrastructure"
          description="Every component runs on a free tier for the course demo."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Service</Th>
              <Th>Notes</Th>
              <Th align="right">Monthly (BDT)</Th>
            </tr>
          </thead>
          <tbody>
            {data.components.map((component) => (
              <Tr key={component.name}>
                <Td className="font-semibold text-ink">{component.name}</Td>
                <Td className="text-muted">{component.note}</Td>
                <Td align="right" className="tnum">
                  {component.cost.toLocaleString('en-US')}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}
