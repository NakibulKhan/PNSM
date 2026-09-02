/**
 * Attendance log (FR-10): filterable, paginated, exportable.
 *
 * The date filter is the subtle part. The user picks Dhaka calendar dates; the
 * query must carry UTC instants for those Dhaka day boundaries, or the last six
 * hours of every day silently vanish (Dhaka is UTC+6, so a local day starts at
 * 18:00Z the previous day). `dhakaDayStartUtc` / `dhakaDayEndUtc` do that
 * conversion, and nothing here constructs a boundary by hand.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ConfidenceLegend } from '@/components/ui/confidence-bar';
import { DataTable } from './data-table';
import { attendanceColumns } from './columns';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/auth/auth-context';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { dhakaDayEndUtc, dhakaDayStartUtc, lastNDhakaDateKeys, todayDhakaKey } from '@/lib/tz';
import { exportAttendanceCsv } from '@/lib/export-csv';
import { exportAttendancePdf } from '@/lib/export-pdf';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { AttendanceLog, Office } from '@/types/models';
import type { ApiMeta } from '@/types/api';

export function AttendanceView({ initialStatus = 'all' }: { initialStatus?: string }) {
  const user = useSession();
  const { toast } = useToast();
  const weekKeys = useMemo(() => lastNDhakaDateKeys(7), []);

  const [from, setFrom] = useState(weekKeys[0]);
  const [to, setTo] = useState(todayDhakaKey());
  const [officeId, setOfficeId] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { data: offices } = useQuery({
    queryKey: queryKeys.offices,
    queryFn: () => fetchData<Office[]>('offices'),
    staleTime: 5 * 60_000,
  });

  const query = useMemo(
    () => ({
      from: dhakaDayStartUtc(from).toISOString(),
      to: dhakaDayEndUtc(to).toISOString(),
      officeId: officeId || undefined,
      // 'all' is this component's own UI sentinel for "no filter" (the
      // <option value="all"> below) — the backend's listAttendanceQuerySchema
      // has no such value, only the real enum plus .optional(), so sending
      // the literal string always failed validation with 422. A live
      // end-to-end run (ROADMAP.md Phase 5) found this made the Attendance
      // Logs page permanently broken on its own default filter state
      // (status defaults to 'all' right above). officeId already handles the
      // equivalent case correctly one line up; status needs the same.
      status: status === 'all' ? undefined : status,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    }),
    [from, to, officeId, status, page],
  );

  const { data, isPending } = useQuery({
    queryKey: queryKeys.attendance(query),
    queryFn: async () => {
      const response = await api.get<AttendanceLog[]>('attendance', query);
      return { rows: response.data, meta: response.meta as ApiMeta | undefined };
    },
  });

  /** Exports the whole filtered range, not just the page on screen. */
  const fetchAllForExport = async (): Promise<AttendanceLog[]> => {
    const response = await api.get<AttendanceLog[]>('attendance', {
      ...query,
      page: 1,
      pageSize: 5_000,
    });
    return response.data;
  };

  const onExportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      exportAttendanceCsv(rows);
      toast({ tone: 'success', title: 'Exported', description: `${rows.length} records saved as CSV.` });
    } catch {
      toast({ tone: 'error', title: 'Export failed', description: 'Narrow the date range and try again.' });
    } finally {
      setExporting(false);
    }
  };

  const onExportPdf = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      await exportAttendancePdf(rows, {
        title: 'Attendance & Payroll Report',
        fromDate: dhakaDayStartUtc(from).toISOString(),
        toDate: dhakaDayEndUtc(to).toISOString(),
        officeName: offices?.find((office) => office._id === officeId)?.office_name,
        preparedBy: user?.name,
      });
      toast({ tone: 'success', title: 'Exported', description: `${rows.length} records saved as PDF.` });
    } catch {
      toast({ tone: 'error', title: 'Export failed', description: 'Narrow the date range and try again.' });
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setFrom(weekKeys[0]);
    setTo(todayDhakaKey());
    setOfficeId('');
    setStatus('all');
    setPage(1);
  };

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Field label="From">
            <Input
              type="date"
              value={from}
              max={to}
              numeric
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          <Field label="To">
            <Input
              type="date"
              value={to}
              min={from}
              numeric
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>

          <Field label="Office">
            <Select
              value={officeId}
              onChange={(event) => {
                setOfficeId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All offices</option>
              {offices?.map((office) => (
                <option key={office._id} value={office._id}>
                  {office.office_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Verification status">
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="approved">Approved</option>
              <option value="flagged">Needs review</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>

          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <RotateCcw size={13} aria-hidden /> Reset
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <ConfidenceLegend />
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" loading={exporting} onClick={onExportCsv}>
              <Download size={13} aria-hidden /> CSV
            </Button>
            <Button variant="secondary" size="sm" loading={exporting} onClick={onExportPdf}>
              <FileText size={13} aria-hidden /> PDF
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={attendanceColumns}
          data={data?.rows ?? []}
          meta={data?.meta}
          isLoading={isPending}
          getRowId={(row) => row._id}
          onPageChange={setPage}
          emptyTitle="No check-ins in this range"
          emptyMessage="Widen the dates or clear the office and status filters."
        />
      </Card>
    </>
  );
}
