import { cn } from '@/lib/utils';
import { IS_DEMO } from '@/config/env';
import { useOnline } from '@/hooks/use-online';
import type { ConnectionState } from '@/hooks/use-socket';

/**
 * States the truth about the live feed.
 *
 * On an unreliable link, the difference between "nothing is happening" and "we
 * lost the connection" matters enormously to someone monitoring attendance, so
 * this is always visible rather than tucked into a menu.
 */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const online = useOnline();
  const resolved: ConnectionState | 'no-network' = !online ? 'no-network' : state;

  const config = {
    live: { label: IS_DEMO ? 'Live (demo)' : 'Live', dot: 'bg-verified', text: 'text-verified' },
    connecting: { label: 'Connecting', dot: 'bg-flagged', text: 'text-flagged' },
    offline: { label: 'Feed offline', dot: 'bg-rejected', text: 'text-rejected' },
    'no-network': { label: 'No network', dot: 'bg-rejected', text: 'text-rejected' },
  }[resolved];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-surface px-2 py-1"
      title={
        resolved === 'live'
          ? 'Receiving check-ins as they happen'
          : 'New check-ins will appear once the connection returns'
      }
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', config.dot, resolved === 'live' && 'pulse-dot')}
        aria-hidden
      />
      <span className={cn('text-[11px] font-semibold', config.text)}>{config.label}</span>
    </span>
  );
}
