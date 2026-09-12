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
import { SOCKET_EVENTS, SOCKET_AUTH_FAILURE_MESSAGE } from '@/lib/constants';
import { refreshAccessToken } from '@/api/http';
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

    /*
     * M4: socket.io-client's built-in reconnection (reconnectionAttempts:
     * Infinity in socket.ts) retries forever on a plain network drop, and its
     * `auth` callback re-reads the access token fresh on every attempt — so a
     * token that gets refreshed by an unrelated HTTP call is picked up
     * automatically. But if the tab sits idle on the dashboard with the
     * socket as the only live connection, the 15-minute access token can
     * expire with no HTTP request ever failing to trigger that refresh. The
     * next reconnection attempt then re-sends the same stale token, the
     * server's handshake middleware rejects it with SOCKET_AUTH_FAILURE_MESSAGE
     * every time, and the feed was dead until a full reload. Recognising that
     * specific rejection and refreshing proactively closes the gap: by the
     * time socket.io's own reconnectionDelay elapses, the auth callback reads
     * a live token instead of the one that just got rejected.
     */
    const onConnectError = (payload: unknown) => {
      setState('offline');
      const message = payload instanceof Error ? payload.message : undefined;
      if (message === SOCKET_AUTH_FAILURE_MESSAGE) {
        refreshAccessToken().catch(() => {
          // Refresh token is also gone — the HTTP layer's own 401 handling
          // will send the user to /login on their next API call. Nothing
          // more to do here; the socket keeps retrying harmlessly.
        });
      }
    };

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
