/**
 * Subscribes the console to live attendance events.
 *
 * Two correctness guarantees:
 *   - Exactly one connection survives React 18 StrictMode's double mount,
 *     because the socket is a module singleton and the effect cleans up.
 *   - Events are deduplicated by `_id` before they reach the cache, so a
 *     reconnect that replays recent events cannot double-render the feed.
 *
 * Socket payloads are merged directly into the TanStack Query cache rather than
 * held in separate state. That keeps one source of truth: a screen showing
 * fetched history and a screen showing pushed events can never disagree.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import { SOCKET_EVENTS } from '@/lib/constants';
import { queryKeys } from '@/lib/query-keys';
import type { AttendanceLog } from '@/types/models';

export type ConnectionState = 'connecting' | 'live' | 'offline';

export function useAttendanceSocket(enabled = true) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onConnect = () => setState('live');
    const onDisconnect = () => setState('offline');
    const onConnectError = () => setState('offline');

    const onAttendance = (payload: unknown) => {
      const log = payload as AttendanceLog;
      if (!log?._id) return;

      queryClient.setQueryData<AttendanceLog[]>(queryKeys.feed, (previous = []) => {
        if (previous.some((existing) => existing._id === log._id)) return previous;
        return [log, ...previous].slice(0, 40);
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.kpis });
      queryClient.invalidateQueries({ queryKey: queryKeys.trend(7) });
      if (log.status === 'flagged') {
        queryClient.invalidateQueries({ queryKey: queryKeys.flagged });
      }
      setLastEventAt(new Date().toISOString());
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on(SOCKET_EVENTS.attendanceNew, onAttendance);

    socket.connect();
    if (socket.connected) setState('live');

    // This cleanup is what makes StrictMode's second mount harmless.
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off(SOCKET_EVENTS.attendanceNew, onAttendance);
      socket.disconnect();
    };
  }, [enabled, queryClient]);

  return { state, lastEventAt };
}
