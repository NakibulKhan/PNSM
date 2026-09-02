import { PageHeader } from '@/components/common/page-header';
import { EmployeesView } from '@/components/tables/employees-view';

export default function EmployeesPage() {
  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone enrolled for biometric check-in, and the office each is assigned to."
      />
      <EmployeesView />
    </>
  );
}
