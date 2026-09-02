import { PageHeader } from '@/components/common/page-header';
import { BillingView } from '@/components/dashboard/admin-views';

export default function BillingPage() {
  return (
    <>
      <PageHeader
        title="Billing"
        description="What the platform costs to run, broken down by service."
      />
      <BillingView />
    </>
  );
}
