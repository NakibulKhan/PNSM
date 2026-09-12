import { cn } from '@/lib/utils';

/**
 * No apologies, no personality — state what failed, in the anomaly signal
 * colour. `waking` is the one exception: a cold free-tier backend
 * (isBackendWaking) is waiting, not broken, and the anomaly-red title would
 * say otherwise regardless of what the copy itself reads — swaps to the same
 * accent colour WakingState's own icon uses, matching that component's tone
 * exactly rather than inventing a third signal colour.
 */
export function TileError({
  title = 'Unavailable',
  message = 'This will appear once the connection returns.',
  waking = false,
}: {
  title?: string;
  message?: string;
  waking?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <p className={cn('text-[13px] font-semibold', waking ? 'text-accent' : 'text-anomaly')}>{title}</p>
      <p className="text-[12.5px] text-ink-faint">{message}</p>
    </div>
  );
}
