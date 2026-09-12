import { Link, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmployeeDetailView } from '@/components/dashboard/employee-detail';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/common/states';

/**
 * Dynamic route. React Router resolves `:id` synchronously through `useParams`,
 * so there is none of the async-params ceremony a server framework requires —
 * but the value is `string | undefined`, and a missing id must be handled rather
 * than passed downstream to produce a confusing 404 from the API.
 */
export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <div className="card">
        <ErrorState message="No employee was specified in the address." />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Employee profile"
        description="Identity, biometric baseline, assigned geofence and attendance history."
        actions={
          <Link to="/employees">
            <Button variant="secondary" size="sm">
              <ChevronLeft size={14} aria-hidden /> All employees
            </Button>
          </Link>
        }
      />
      <EmployeeDetailView employeeId={id} />
    </>
  );
}
