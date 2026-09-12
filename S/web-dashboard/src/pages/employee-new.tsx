import { PageHeader } from '@/components/common/page-header';
import { EmployeeForm } from '@/components/forms/employee-form';

export default function NewEmployeePage() {
  return (
    <>
      <PageHeader
        title="Add employee"
        description="Onboard a new employee and generate their biometric baseline and 2FA PIN."
      />
      <EmployeeForm />
    </>
  );
}
