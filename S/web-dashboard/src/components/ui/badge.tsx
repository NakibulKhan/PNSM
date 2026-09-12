import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AttendanceStatus, LeaveStatus } from '@/types/models';
import { LEAVE_STATUS_LABEL, STATUS_LABEL } from '@/lib/format';

type Tone = 'neutral' | 'accent' | 'verified' | 'flagged' | 'rejected';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-canvas text-muted border-line-strong',
  accent: 'bg-accent-soft text-accent-dark border-accent/25',
  verified: 'bg-verified-soft text-verified border-verified/25',
  flagged: 'bg-flagged-soft text-flagged border-flagged/25',
  rejected: 'bg-rejected-soft text-rejected border-rejected/25',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[11px] font-semibold',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusTone: Record<AttendanceStatus, Tone> = {
  approved: 'verified',
  flagged: 'flagged',
  rejected: 'rejected',
};

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  return <Badge tone={statusTone[status]}>{STATUS_LABEL[status]}</Badge>;
}

const leaveTone: Record<LeaveStatus, Tone> = {
  pending: 'flagged',
  approved: 'verified',
  rejected: 'rejected',
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={leaveTone[status]}>{LEAVE_STATUS_LABEL[status]}</Badge>;
}
