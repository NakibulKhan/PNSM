import { useQuery } from '@tanstack/react-query';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSession } from '@/auth/auth-context';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { ROLE_LABEL, ROLE_PERMISSIONS } from '@/lib/rbac';
import { APP_TIMEZONE, FACE_MATCH_THRESHOLD } from '@/lib/constants';
import { IS_DEMO } from '@/config/env';
import { formatDateTime } from '@/lib/tz';
import type { SpoofAlert } from '@/types/models';

/**
 * Account and environment. Also surfaces mock-location alerts, because a
 * spoofing attempt is a security event HR must see even if no check-in was
 * recorded from it (FR-05).
 */
export function SettingsView() {
  const user = useSession();

  const { data: alerts } = useQuery({
    queryKey: queryKeys.spoofAlerts,
    queryFn: () => fetchData<SpoofAlert[]>('spoof-alerts'),
    staleTime: 60_000,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your account" />
        <CardBody>
          <dl className="space-y-2.5">
            {[
              ['Name', user?.name ?? '—'],
              ['Email', user?.email ?? '—'],
              ['Role', user ? ROLE_LABEL[user.role] : '—'],
              ['Timezone', APP_TIMEZONE],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <dt className="eyebrow">{label}</dt>
                <dd className="text-[12.5px] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What your role can do"
          description="Enforced by the API as well as hidden in this interface."
        />
        <CardBody>
          <div className="flex flex-wrap gap-1.5">
            {(user ? ROLE_PERMISSIONS[user.role] : []).map((permission) => (
              <Badge key={permission} tone="neutral">
                <span className="tnum">{permission}</span>
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Verification rules" description="Set globally by the Super Admin." />
        <CardBody>
          <dl className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="eyebrow">Auto-approval threshold</dt>
              <dd className="tnum text-[13px] font-semibold text-verified">{FACE_MATCH_THRESHOLD}%</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="eyebrow">Mock-location check-ins</dt>
              <dd>
                <Badge tone="rejected">Blocked</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="eyebrow">Data source</dt>
              <dd>
                {IS_DEMO ? <Badge tone="flagged">Demo data</Badge> : <Badge tone="verified">Live API</Badge>}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Spoofing alerts"
          description="Blocked attempts to check in from a faked location"
        />
        <CardBody>
          {!alerts || alerts.length === 0 ? (
            <p className="text-[12.5px] text-muted">No spoofing attempts recorded.</p>
          ) : (
            <ul className="space-y-2.5">
              {alerts.map((alert) => (
                <li key={alert._id} className="border-b border-line pb-2.5 last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] font-semibold text-ink">{alert.employee_name}</p>
                    <Badge tone="rejected">Blocked</Badge>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted">{alert.reason}</p>
                  <p className="tnum mt-0.5 text-[10.5px] text-faint">
                    {formatDateTime(alert.detected_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
