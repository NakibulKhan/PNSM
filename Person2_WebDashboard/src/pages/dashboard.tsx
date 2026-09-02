import { Link } from 'react-router-dom';
import { UserPlus, FileDown } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { KpiRow } from '@/components/dashboard/kpi-row';
import { LiveFeed } from '@/components/dashboard/live-feed';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { Button } from '@/components/ui/button';
import { RbacGate } from '@/components/common/rbac-gate';
import { useSession } from '@/auth/auth-context';
import { APP_TIMEZONE } from '@/lib/constants';

/**
 * Wireframe Fig 3.4, assembled: four KPI cards, the live check-in feed, and the
 * seven-day trend. `split-grid` and `kpi-grid` carry the Safari 16.3 flexbox
 * fallbacks declared in index.css.
 */
export default function DashboardPage() {
  const user = useSession();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description={`Live attendance across all branches. All times ${APP_TIMEZONE}.`}
        actions={
          <>
            <RbacGate permission="report:export">
              <Link to="/reports">
                <Button variant="secondary" size="sm">
                  <FileDown size={14} aria-hidden /> Export report
                </Button>
              </Link>
            </RbacGate>
            <RbacGate permission="employee:write">
              <Link to="/employees/new">
                <Button size="sm">
                  <UserPlus size={14} aria-hidden /> Add employee
                </Button>
              </Link>
            </RbacGate>
          </>
        }
      />

      <div className="space-y-4">
        <KpiRow />
        <div className="split-grid grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="split-main">
            <TrendChart days={7} />
          </div>
          <div className="split-aside">
            <LiveFeed />
          </div>
        </div>
      </div>
    </>
  );
}
