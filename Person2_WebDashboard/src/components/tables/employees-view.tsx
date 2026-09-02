import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { SearchInput } from '@/components/layout/topbar';
import { DataTable } from './data-table';
import { employeeColumns } from './columns';
import { RbacGate } from '@/components/common/rbac-gate';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { useDebounce } from '@/hooks/use-debounce';
import { exportGenericCsv } from '@/lib/export-csv';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { Office, User } from '@/types/models';
import type { ApiMeta } from '@/types/api';

export function EmployeesView() {
  const [search, setSearch] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  const { data: offices } = useQuery({
    queryKey: queryKeys.offices,
    queryFn: () => fetchData<Office[]>('offices'),
    staleTime: 5 * 60_000,
  });

  const { data, isPending } = useQuery({
    queryKey: ['employees', { search: debouncedSearch, officeId, page }],
    queryFn: async () => {
      const response = await api.get<User[]>('employees', {
        search: debouncedSearch,
        officeId,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      return { rows: response.data, meta: response.meta as ApiMeta | undefined };
    },
  });

  const exportList = () => {
    const rows = (data?.rows ?? []).map((employee) => ({
      'Employee ID': employee.employee_code ?? '',
      Name: employee.name,
      Email: employee.email,
      Mobile: employee.phone,
      Department: employee.department ?? '',
      Office: (employee as User & { office_name?: string }).office_name ?? '',
      'Baseline enrolled': employee.has_face_embedding ? 'Yes' : 'No',
      Status: employee.is_active === false ? 'Deactivated' : 'Active',
    }));
    exportGenericCsv(rows, 'pnsm-employees.csv');
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, ID or email" />

        <Select
          value={officeId}
          onChange={(event) => {
            setOfficeId(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[170px]"
          aria-label="Filter by office"
        >
          <option value="">All offices</option>
          {offices?.map((office) => (
            <option key={office._id} value={office._id}>
              {office.office_name}
            </option>
          ))}
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportList}>
            <Download size={13} aria-hidden /> Export list
          </Button>
          <RbacGate permission="employee:write">
            <Link to="/employees/new">
              <Button size="sm">
                <UserPlus size={14} aria-hidden /> Add employee
              </Button>
            </Link>
          </RbacGate>
        </div>
      </div>

      <Card>
        <DataTable
          columns={employeeColumns}
          data={data?.rows ?? []}
          meta={data?.meta}
          isLoading={isPending}
          getRowId={(row) => row._id}
          onPageChange={setPage}
          emptyTitle="No employees match"
          emptyMessage="Clear the search or choose a different office."
        />
      </Card>
    </>
  );
}
