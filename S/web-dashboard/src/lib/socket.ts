/**
 * Socket.IO singleton.
 *
 * HANDSHAKE AUTHENTICATION
 * ------------------------
 * The JWT travels in the handshake `auth` payload, not a query string, so it
 * never lands in server access logs or proxy history. Because the access token
 * rotates every 15 minutes, `auth` is set as a *callback*: Socket.IO invokes it
 * on every connection AND every reconnection attempt, so a socket that drops
 * during a token refresh reconnects with the new token rather than replaying a
 * dead one.
 *
 * THE DOUBLE-CONNECTION BUG
 * -------------------------
 * React 18 StrictMode mounts, unmounts and remounts every component in
 * development to expose missing cleanup. socket.io-client connects the instant
 * an instance is constructed, so a socket created inside a component spawns a
 * second, orphaned connection — and every check-in then appears twice in the HR
 * feed. Three rules defeat it, all applied here:
 *   1. the instance is created ONCE, outside the React tree,
 *   2. it is created with autoConnect: false,
 *   3. the consuming hook connects in an effect and disconnects in cleanup.
 */
import { io, type Socket } from 'socket.io-client';
import { IS_DEMO, SOCKET_URL } from '@/config/env';
import { SOCKET_EVENTS } from './constants';
import { getAccessToken } from '@/api/token-store';

export type SocketHandler = (payload: unknown) => void;

export interface AppSocket {
  connect(): void;
  disconnect(): void;
  on(event: string, handler: SocketHandler): void;
  off(event: string, handler?: SocketHandler): void;
  readonly connected: boolean;
}

/**
 * Simulated transport for demo mode. Emits a plausible check-in every few
 * seconds so the live feed, KPI cards and toasts all animate with no backend
 * and no network — which also makes it immune to venue WiFi blocking WebSockets.
 */
class SimulatedSocket implements AppSocket {
  private handlers = new Map<string, Set<SocketHandler>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private open = false;

  get connected() {
    return this.open;
  }

  connect() {
    if (this.open) return;
    this.open = true;
    setTimeout(() => this.emitLocal('connect', undefined), 0);
    this.timer = setInterval(async () => {
      const { generateLiveCheckIn } = await import('@/mocks/mock-api');
      const log = generateLiveCheckIn();
      this.emitLocal(SOCKET_EVENTS.attendanceNew, log);
      if (log.status === 'flagged') this.emitLocal(SOCKET_EVENTS.attendanceFlagged, log);
    }, 9_000);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.open = false;
    this.emitLocal('disconnect', 'io client disconnect');
  }

  on(event: string, handler: SocketHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler?: SocketHandler) {
    if (!handler) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.get(event)?.delete(handler);
  }

  private emitLocal(event: string, payload: unknown) {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

let instance: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (instance) return instance;

  if (IS_DEMO) {
    instance = new SimulatedSocket();
    return instance;
  }

  const client: Socket = io(SOCKET_URL, {
    autoConnect: false,
    /*
     * Callback form: re-evaluated on every (re)connection, so the socket always
     * presents the current access token from memory.
     */
    auth: (callback: (data: Record<string, unknown>) => void) => {
      callback({ token: getAccessToken() });
    },
    /*
     * Polling is kept as a fallback. Campus and conference networks frequently
     * block or proxy the WebSocket upgrade; without this the live feed simply
     * never connects at the one moment it needs to.
     */
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 8_000,
    timeout: 20_000,
  });

  instance = client as unknown as AppSocket;
  return instance;
}

/** Test seam: drop the singleton so each test starts clean. */
export function resetSocketForTests(): void {
  instance = null;
}
