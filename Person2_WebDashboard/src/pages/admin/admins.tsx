import { PageHeader } from '@/components/common/page-header';
import { AdminAccountsView } from '@/components/dashboard/admin-views';

export default function AdminsPage() {
  return (
    <>
      <PageHeader
        title="Admin accounts"
        description="Who can manage each branch, and who has executive access."
      />
      <AdminAccountsView />
    </>
  );
}
