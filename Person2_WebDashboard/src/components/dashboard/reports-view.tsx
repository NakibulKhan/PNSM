/**
 * Report builder (FR-10). Chooses a period and scope, previews the totals, then
 * exports CSV or a payroll-ready PDF. Generation is client-side so a sleeping
 * backend cannot block a report the user already has data for.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Stat } from '@/components/common/stat';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/auth/auth-context';
import { api, fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { dhakaDayEndUtc, dhakaDayStartUtc, lastNDhakaDateKeys, todayDhakaKey } from '@/lib/tz';
import { exportAttendanceCsv } from '@/lib/export-csv';
import { exportAttendancePdf } from '@/lib/export-pdf';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import type { AttendanceLog, Office } from '@/types/models';

export function ReportsView() {
  const { toast } = useToast();
  const user = useSession();
  const monthKeys = useMemo(() => lastNDhakaDateKeys(30), []);

  const [from, setFrom] = useState(monthKeys[0]);
  const [to, setTo] = useState(todayDhakaKey());
  const [officeId, setOfficeId] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: offices } = useQuery({
    queryKey: queryKeys.offices,
    queryFn: () => fetchData<Office[]>('offices'),
    staleTime: 5 * 60_000,
  });

  const range = useMemo(
    () => ({
      from: dhakaDayStartUtc(from).toISOString(),
      to: dhakaDayEndUtc(to).toISOString(),
    }),
    [from, to],
  );

  const { data: rows, isPending } = useQuery({
    queryKey: ['reports', range, officeId],
    queryFn: async () => {
      const response = await api.get<AttendanceLog[]>('attendance', {
        ...range,
        officeId: officeId || undefined,
        pageSize: 5_000,
      });
      return response.data;
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const checkIns = list.filter((log) => log.check_type === 'check_in');
    const scores = list.map((log) => log.face_match_score);
    return {
      records: list.length,
      checkIns: checkIns.length,
      uniqueEmployees: new Set(list.map((log) => log.user_id)).size,
      flagged: list.filter((log) => log.status === 'flagged').length,
      rejected: list.filter((log) => log.status === 'rejected').length,
      avgMatch: scores.length
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : 0,
    };
  }, [rows]);

  const officeName = offices?.find((office) => office._id === officeId)?.office_name;

  const runExport = async (format: 'csv' | 'pdf') => {
    if (!rows || rows.length === 0) {
      toast({
        tone: 'error',
        title: 'Nothing to export',
        description: 'No records fall in this period.',
      });
      return;
    }
    setBusy(true);
    try {
      if (format === 'csv') {
        exportAttendanceCsv(rows, `pnsm-attendance-${from}-to-${to}.csv`);
      } else {
        await exportAttendancePdf(rows, {
          title: 'Attendance & Payroll Report',
          fromDate: range.from,
          toDate: range.to,
          officeName,
          preparedBy: user?.name,
        });
      }
      toast({
        tone: 'success',
        title: 'Exported',
        description: `${rows.length} records saved as ${format.toUpperCase()}.`,
      });
    } catch {
      toast({
        tone: 'error',
        title: 'Export failed',
        description: 'Try a shorter period, or a single office.',
      });
    } finally {
      setBusy(false);
    }
  };

  const setPreset = (days: number) => {
    const keys = lastNDhakaDateKeys(days);
    setFrom(keys[0]);
    setTo(keys[keys.length - 1]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Build a report"
          description="Payroll-ready attendance for a period and location. All dates are Asia/Dhaka calendar days."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From">
              <Input type="date" value={from} max={to} numeric onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} min={from} numeric onChange={(event) => setTo(event.target.value)} />
            </Field>
            <Field label="Office">
              <Select value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
                <option value="">All offices</option>
                {offices?.map((office) => (
                  <option key={office._id} value={office._id}>
                    {office.office_name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Quick ranges</span>
            <Button variant="secondary" size="sm" onClick={() => setPreset(7)}>
              Last 7 days
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset(30)}>
              Last 30 days
            </Button>
          </div>
        </CardBody>

        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11.5px] text-faint">
            PDF marks any match below {FACE_MATCH_THRESHOLD}% so payroll sees the exceptions.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" loading={busy} onClick={() => runExport('csv')}>
              <Download size={14} aria-hidden /> Export CSV
            </Button>
            <Button loading={busy} onClick={() => runExport('pdf')}>
              <FileText size={14} aria-hidden /> Export PDF
            </Button>
          </div>
        </CardFooter>
      </Card>

      {isPending ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[92px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Records in period" value={summary.records} tone="accent" footnote={`${summary.checkIns} check-ins`} />
            <Stat label="Employees covered" value={summary.uniqueEmployees} />
            <Stat
              label="Avg face match"
              value={summary.avgMatch.toFixed(1)}
              suffix="%"
              tone={summary.avgMatch >= FACE_MATCH_THRESHOLD ? 'verified' : 'flagged'}
            />
            <Stat
              label="Exceptions"
              value={summary.flagged + summary.rejected}
              tone={summary.flagged + summary.rejected > 0 ? 'flagged' : 'neutral'}
              footnote={`${summary.flagged} flagged · ${summary.rejected} rejected`}
            />
          </div>

          <Card>
            <CardBody>
              <p className="eyebrow mb-2">What the export contains</p>
              <ul className="grid gap-1 text-[12px] text-muted sm:grid-cols-2">
                <li>Employee ID and name</li>
                <li>Office and geofence validated against</li>
                <li>Dhaka-local date and time of each event</li>
                <li>Check-in or check-out</li>
                <li>Face-match score to one decimal</li>
                <li>Verification status and mock-location flag</li>
                <li>GPS latitude and longitude (CSV only)</li>
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
