import { PageHeader } from '@/components/common/page-header';
import { AttendanceView } from '@/components/tables/attendance-view';

export default function AttendancePage() {
  return (
    <>
      <PageHeader
        title="Attendance logs"
        description="Every check-in and check-out with its GPS reading and face-match score."
      />
      <AttendanceView />
    </>
  );
}
