/**
 * Report builder (FR-10). Chooses a period and scope, previews the totals, then
 * exports CSV or a payroll-ready PDF. Generation is client-side so a sleeping
 * backend cannot block a report the user already has data for.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile, useTileHeading } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
import { StatTile } from '@/components/bento/StatTile';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/auth/auth-context';
import { fetchData } from '@/api/client';
import { fetchAllAttendance } from '@/lib/fetch-all-attendance';
import { queryKeys } from '@/lib/query-keys';
import { dhakaDayEndUtc, dhakaDayStartUtc, lastNDhakaDateKeys, todayDhakaKey } from '@/lib/tz';
import { exportAttendanceCsv } from '@/lib/export-csv';
import { exportAttendancePdf } from '@/lib/export-pdf';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import type { Office } from '@/types/models';

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
    // Paginated at the server's own 200-row cap. Asking for 5000 in one call
    // used to 422 and left this entire screen blank — see fetch-all-attendance.ts.
    queryFn: () => fetchAllAttendance({ ...range, officeId: officeId || undefined }),
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
    <BentoGrid>
      <BentoTile rank="rail">
        <RailHeading />
        <div className="grid gap-3 p-4 sm:grid-cols-3">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">Quick ranges</span>
            <Button variant="secondary" size="sm" onClick={() => setPreset(7)}>
              Last 7 days
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPreset(30)}>
              Last 30 days
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" loading={busy} onClick={() => runExport('csv')}>
              <Download size={14} aria-hidden /> Export CSV
            </Button>
            <Button loading={busy} onClick={() => runExport('pdf')}>
              <FileText size={14} aria-hidden /> Export PDF
            </Button>
          </div>
        </div>
        <p className="px-4 pb-3 text-[11.5px] text-faint">
          PDF marks any match below {FACE_MATCH_THRESHOLD}% so payroll sees the exceptions.
        </p>
      </BentoTile>

      <StatTile
        rank="chip"
        state={isPending ? 'loading' : 'ready'}
        label="Records in period"
        value={summary.records}
        tone="accent"
        footnote={`${summary.checkIns} check-ins`}
      />
      <StatTile
        rank="chip"
        state={isPending ? 'loading' : 'ready'}
        label="Employees covered"
        value={summary.uniqueEmployees}
      />
      <StatTile
        rank="chip"
        state={isPending ? 'loading' : 'ready'}
        label="Avg face match"
        value={summary.avgMatch.toFixed(1)}
        suffix="%"
        tone={summary.avgMatch >= FACE_MATCH_THRESHOLD ? 'verified' : 'flagged'}
      />
      <StatTile
        rank="chip"
        state={isPending ? 'loading' : 'ready'}
        label="Exceptions"
        value={summary.flagged + summary.rejected}
        tone={summary.flagged + summary.rejected > 0 ? 'flagged' : 'neutral'}
        footnote={
          <span className="flex gap-2">
            <span>{summary.flagged} flagged</span>
            <span>{summary.rejected} rejected</span>
          </span>
        }
      />

      <BentoTile rank="wide">
        <TileHeader title="What the export contains" />
        <ul className="grid gap-1 p-4 pt-2 text-[12px] text-muted sm:grid-cols-2">
          <li>Employee ID and name</li>
          <li>Office and geofence validated against</li>
          <li>Dhaka-local date and time of each event</li>
          <li>Check-in or check-out</li>
          <li>Face-match score to one decimal</li>
          <li>Verification status and mock-location flag</li>
          <li>GPS latitude and longitude (CSV only)</li>
        </ul>
      </BentoTile>
    </BentoGrid>
  );
}

/** A rail tile is just a filter bar, but every tile still needs its own accessible name (§10). */
function RailHeading() {
  const { id } = useTileHeading();
  return (
    <h3 id={id} className="sr-only">
      Build a report
    </h3>
  );
}
