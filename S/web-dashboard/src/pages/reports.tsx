import { PageHeader } from '@/components/common/page-header';
import { ReportsView } from '@/components/dashboard/reports-view';

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Export payroll-ready attendance for any period and location."
      />
      <ReportsView />
    </>
  );
}
