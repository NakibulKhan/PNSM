import { cn } from '@/lib/utils';
import { FACE_MATCH_THRESHOLD } from '@/lib/constants';
import { matchVerdict } from '@/lib/format';

/**
 * The product's signature instrument.
 *
 * A face-match score means nothing on its own — what HR needs to know is where
 * it sits relative to the 85% auto-approval rule (FR-07). So the score is never
 * shown as a bare number: it is always shown against a bar with a tick at the
 * threshold. One glance answers "did this pass, and by how much".
 *
 * Used identically in the live feed, the attendance log and the review queue,
 * so the reading is learned once.
 */
export function ConfidenceBar({
  score,
  showValue = true,
  width = 'w-24',
  className,
}: {
  score: number;
  showValue?: boolean;
  width?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const verdict = matchVerdict(clamped);
  const isVerified = verdict === 'verified';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn('relative h-[6px] shrink-0 overflow-hidden rounded-full bg-line', width)}
        role="img"
        aria-label={`Face match ${clamped.toFixed(1)} percent, ${
          isVerified ? 'at or above' : 'below'
        } the ${FACE_MATCH_THRESHOLD} percent threshold`}
      >
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', isVerified ? 'bg-verified' : 'bg-flagged')}
          style={{ width: `${clamped}%` }}
        />
        {/* Threshold tick: the decision boundary, drawn on top of the fill. */}
        <div
          className="absolute inset-y-[-2px] w-[2px] bg-ink/70"
          style={{ left: `${FACE_MATCH_THRESHOLD}%` }}
          aria-hidden
        />
      </div>
      {showValue ? (
        <span
          className={cn(
            'tnum text-[12px] font-semibold',
            isVerified ? 'text-verified' : 'text-flagged',
          )}
        >
          {clamped.toFixed(1)}%
        </span>
      ) : null}
    </div>
  );
}

/** Legend shown once per screen so the tick is self-explanatory. */
export function ConfidenceLegend({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-[11px] text-faint', className)}>
      <span className="inline-flex h-[6px] w-8 items-center overflow-hidden rounded-full bg-line">
        <span className="h-full w-2/3 rounded-full bg-verified" />
      </span>
      <span>
        Face match, with a tick at the <span className="tnum">{FACE_MATCH_THRESHOLD}%</span>{' '}
        auto-approval threshold
      </span>
    </p>
  );
}
