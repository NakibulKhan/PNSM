/** Column definitions shared by the attendance and employee tables. */
import { Link } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Avatar } from '@/components/ui/avatar';
import { SelfieAvatar } from '@/components/ui/selfie-avatar';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { formatDate, formatTime } from '@/lib/tz';
import { checkTypeLabel } from '@/lib/format';
import { formatLatLng, pointToLatLng } from '@/lib/geo';
import type { AttendanceLog, User } from '@/types/models';

export const attendanceColumns: ColumnDef<AttendanceLog, unknown>[] = [
  {
    id: 'employee',
    header: 'Employee',
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <SelfieAvatar
          logId={row.original._id}
          selfieKey={row.original.selfie_url}
          name={row.original.employee_name ?? '—'}
          size={28}
        />
        <div className="min-w-0">
          <Link
            to={`/employees/${row.original.user_id}`}
            className="block truncate text-[13px] font-semibold text-ink hover:text-accent"
          >
            {row.original.employee_name ?? 'Unknown'}
          </Link>
          <span className="tnum text-[11px] text-faint">{row.original.employee_code}</span>
        </div>
      </div>
    ),
  },
  {
    id: 'office',
    header: 'Office',
    cell: ({ row }) => <span className="text-[12.5px] text-muted">{row.original.office_name}</span>,
  },
  {
    id: 'when',
    header: 'Date & time',
    cell: ({ row }) => (
      <div className="tnum text-[12.5px]">
        <span className="block text-ink">{formatTime(row.original.timestamp)}</span>
        <span className="text-[11px] text-faint">{formatDate(row.original.timestamp)}</span>
      </div>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => (
      <Badge tone={row.original.check_type === 'check_in' ? 'accent' : 'neutral'}>
        {checkTypeLabel(row.original.check_type)}
      </Badge>
    ),
  },
  {
    id: 'match',
    header: 'Face match',
    cell: ({ row }) => <ConfidenceBar score={row.original.face_match_score} width="w-20" />,
  },
  {
    id: 'location',
    header: 'GPS',
    cell: ({ row }) => {
      const point = pointToLatLng(row.original.gps_location);
      if (!point) {
        return <span className="text-[11px] text-faint">Unavailable</span>;
      }
      return (
        <span className="tnum text-[11px] text-faint" title={formatLatLng(point.lat, point.lng)}>
          {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
        </span>
      );
    },
  },
  {
    id: 'status',
    header: 'Status',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1.5">
        {row.original.mock_location_detected ? <Badge tone="rejected">Spoofed GPS</Badge> : null}
        <StatusBadge status={row.original.status} />
      </div>
    ),
  },
];

export const employeeColumns: ColumnDef<User, unknown>[] = [
  {
    id: 'name',
    header: 'Employee',
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={row.original.name} src={row.original.reference_photo_url} size={30} />
        <div className="min-w-0">
          <Link
            to={`/employees/${row.original._id}`}
            className="block truncate text-[13px] font-semibold text-ink hover:text-accent"
          >
            {row.original.name}
          </Link>
          <span className="tnum text-[11px] text-faint">{row.original.employee_code}</span>
        </div>
      </div>
    ),
  },
  {
    id: 'department',
    header: 'Department',
    cell: ({ row }) => <span className="text-[12.5px] text-muted">{row.original.department}</span>,
  },
  {
    id: 'office',
    header: 'Assigned office',
    cell: ({ row }) => (
      <span className="text-[12.5px] text-muted">
        {(row.original as User & { office_name?: string }).office_name ?? '—'}
      </span>
    ),
  },
  {
    id: 'contact',
    header: 'Mobile',
    cell: ({ row }) => <span className="tnum text-[12px] text-muted">{row.original.phone}</span>,
  },
  {
    id: 'baseline',
    header: 'Biometric baseline',
    cell: ({ row }) =>
      row.original.has_face_embedding ? (
        <Badge tone="verified">Enrolled</Badge>
      ) : (
        <Badge tone="flagged">No embedding</Badge>
      ),
  },
  {
    id: 'active',
    header: 'Status',
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.is_active === false ? (
        <Badge tone="rejected">Deactivated</Badge>
      ) : (
        <Badge tone="verified">Active</Badge>
      ),
  },
];
