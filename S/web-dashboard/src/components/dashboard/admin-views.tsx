/** Super Admin screens: admin accounts, global policy, audit log, billing. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { TableShell, Td, Th, Tr } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/states';
import { StatTile } from '@/components/bento/StatTile';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
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

  return (
    <BentoGrid>
      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title="Admin accounts"
          support="Accounts that can sign in to this console"
          action={<span className="eyebrow"><span className="tnum text-ink">{data?.length ?? 0}</span> accounts</span>}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={4} className="p-4" />
          ) : (
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
          )}
        </div>
      </BentoTile>
    </BentoGrid>
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
    <BentoGrid>
      <BentoTile rank="wide" span="bento-span-tall" className="max-w-2xl">
        <TileHeader
          title="Global verification policy"
          support="Applies company-wide unless an office overrides it."
        />
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 pt-2">
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
        </div>
        <div className="flex justify-end border-t border-hairline p-4">
          <Button loading={save.isPending} onClick={() => save.mutate(policy)}>
            <Save size={14} aria-hidden /> Save policy
          </Button>
        </div>
      </BentoTile>
    </BentoGrid>
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

  return (
    <BentoGrid>
      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title="Audit log"
          support="Administrative actions across the platform"
          action={
            <Button variant="secondary" size="sm" onClick={exportAudit}>
              Export CSV
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={6} className="p-4" />
          ) : !data || data.length === 0 ? (
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
        </div>
      </BentoTile>
    </BentoGrid>
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
    <BentoGrid>
      <StatTile rank="chip" label="Current plan" value={data.plan} tone="accent" />
      <StatTile rank="chip" label="Seats in use" value={data.seats} footnote="Active employee profiles" />
      <StatTile
        rank="chip"
        label="Monthly cost"
        value={data.monthly_cost_bdt.toLocaleString('en-US')}
        suffix="BDT"
        tone="verified"
        footnote={`Renews ${data.renewal_date}`}
      />

      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title="Infrastructure"
          support="Every component runs on a free tier for the course demo."
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
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
        </div>
      </BentoTile>
    </BentoGrid>
  );
}
