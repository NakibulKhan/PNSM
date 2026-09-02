/** Presentation helpers. Numbers that are measurements render in tabular mono. */
import { FACE_MATCH_THRESHOLD } from './constants';
import type { AttendanceStatus, LeaveStatus } from '@/types/models';

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatMeters(value: number): string {
  return `${Math.round(value)} m`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Verdict language used consistently across feed, table and review queue. */
export function matchVerdict(score: number): 'verified' | 'review' {
  return score >= FACE_MATCH_THRESHOLD ? 'verified' : 'review';
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  approved: 'Approved',
  flagged: 'Needs review',
  rejected: 'Rejected',
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function checkTypeLabel(type: 'check_in' | 'check_out'): string {
  return type === 'check_in' ? 'Check in' : 'Check out';
}

/** Truncate an ObjectId for display without losing recognisability. */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}
