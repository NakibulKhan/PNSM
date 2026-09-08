/**
 * CSV export (FR-10). Runs entirely in the browser from data already fetched,
 * so exporting works even when the backend is asleep.
 */
import Papa from 'papaparse';
import type { AttendanceLog } from '@/types/models';
import { formatDateTime, toDhakaDateKey } from './tz';
import { checkTypeLabel, STATUS_LABEL } from './format';
import { pointToLatLng } from './geo';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function attendanceToRows(logs: AttendanceLog[]) {
  return logs.map((log) => {
    const point = pointToLatLng(log.gps_location);
    return {
      'Employee ID': log.employee_code ?? '',
      Employee: log.employee_name ?? '',
      Office: log.office_name ?? '',
      Date: toDhakaDateKey(log.timestamp),
      'Time (Asia/Dhaka)': formatDateTime(log.timestamp),
      Type: checkTypeLabel(log.check_type),
      'Face match %': log.face_match_score,
      Status: STATUS_LABEL[log.status],
      Latitude: point ? point.lat.toFixed(6) : '',
      Longitude: point ? point.lng.toFixed(6) : '',
      'Mock location': log.mock_location_detected ? 'Yes' : 'No',
    };
  });
}

export function exportAttendanceCsv(logs: AttendanceLog[], filename?: string): void {
  const csv = Papa.unparse(attendanceToRows(logs));
  // BOM keeps Excel from mangling non-ASCII names.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename ?? `pnsm-attendance-${toDhakaDateKey(new Date())}.csv`);
}

export function exportGenericCsv<T extends Record<string, unknown>>(rows: T[], filename: string): void {
  const csv = Papa.unparse(rows);
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}
