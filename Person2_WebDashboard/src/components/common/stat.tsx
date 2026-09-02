import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * KPI tile (wireframe Fig 3.4).
 *
 * Label above, measurement below in tabular mono, and a hairline in the signal
 * colour rather than a tinted card — colour states a fact about the number, it
 * does not decorate the container.
 */
export function Stat({
  label,
  value,
  suffix,
  tone = 'neutral',
  footnote,
  className,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: 'neutral' | 'accent' | 'verified' | 'flagged' | 'rejected';
  footnote?: React.ReactNode;
  className?: string;
}) {
  const rule: Record<string, string> = {
    neutral: 'bg-line-strong',
    accent: 'bg-accent',
    verified: 'bg-verified',
    flagged: 'bg-flagged',
    rejected: 'bg-rejected',
  };

  return (
    <div className={cn('card relative overflow-hidden p-3.5', className)}>
      <span className={cn('absolute inset-x-0 top-0 h-[2px]', rule[tone])} aria-hidden />
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-[26px] font-semibold leading-none text-ink">{value}</span>
        {suffix ? <span className="tnum text-[14px] font-semibold text-muted">{suffix}</span> : null}
      </p>
      {footnote ? <p className="mt-1.5 text-[11.5px] text-faint">{footnote}</p> : null}
    </div>
  );
}
