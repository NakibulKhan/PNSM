import { Link } from 'react-router-dom';
import { UserPlus, FileDown } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { PresentNowTile } from '@/components/dashboard/present-now-tile';
import { KpiChips } from '@/components/dashboard/kpi-chips';
import { LiveFeedTile } from '@/components/dashboard/live-feed-tile';
import { Button } from '@/components/ui/button';
import { RbacGate } from '@/components/common/rbac-gate';
import { useSession } from '@/auth/auth-context';
import { APP_TIMEZONE } from '@/lib/constants';

/**
 * HR Command Center home, Bento composition (PNSM_Bento_Frontend_Master_Prompt.md
 * §6.1): one hero tile answers "how many people are here right now", three
 * chips give the numbers that matter beside it, and the live feed is the tall
 * tile that takes the rest of the screen — reading order equals DOM order,
 * so the hero comes first, the feed last, matching the F-pattern scan path.
 * Network contract is unchanged: same three endpoints, same socket-driven
 * cache invalidation as before this migration — see docs/API_CONTRACT.lock.md §5.
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

      <BentoGrid className="mt-4">
        <PresentNowTile />
        <KpiChips />
        <LiveFeedTile />
      </BentoGrid>
    </>
  );
}
