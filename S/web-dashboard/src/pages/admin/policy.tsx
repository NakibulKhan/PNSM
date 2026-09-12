import { PageHeader } from '@/components/common/page-header';
import { PolicyView } from '@/components/dashboard/admin-views';

export default function PolicyPage() {
  return (
    <>
      <PageHeader
        title="Global policy"
        description="Override the verification thresholds that apply across every branch."
      />
      <PolicyView />
    </>
  );
}
