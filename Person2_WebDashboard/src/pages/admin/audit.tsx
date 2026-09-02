import { PageHeader } from '@/components/common/page-header';
import { AuditView } from '@/components/dashboard/admin-views';

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="A record of administrative actions, exportable for review."
      />
      <AuditView />
    </>
  );
}
