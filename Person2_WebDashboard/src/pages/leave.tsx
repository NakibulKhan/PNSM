import { PageHeader } from '@/components/common/page-header';
import { LeaveQueue } from '@/components/dashboard/leave-queue';

export default function LeavePage() {
  return (
    <>
      <PageHeader
        title="Leave requests"
        description="Approve or reject time off so attendance records reflect authorised absences."
      />
      <LeaveQueue />
    </>
  );
}
