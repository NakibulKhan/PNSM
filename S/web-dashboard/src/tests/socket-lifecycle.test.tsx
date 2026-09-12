/**
 * STRICT MODE DOUBLE-CONNECTION SUITE
 *
 * React 18 StrictMode mounts every component twice in development. If the socket
 * were created inside a component, or connected without a cleanup, the console
 * would hold two connections and show every check-in twice.
 *
 * These tests mount the hook inside <StrictMode> — the exact condition that
 * exposes the bug — and assert one connection survives and zero remain after
 * unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const connect = vi.fn();
const disconnect = vi.fn();
const on = vi.fn();
const off = vi.fn();
let connected = false;

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    connect: () => {
      connect();
      connected = true;
    },
    disconnect: () => {
      disconnect();
      connected = false;
    },
    on,
    off,
    get connected() {
      return connected;
    },
  }),
}));

const refreshAccessToken = vi.fn().mockResolvedValue('new-token');
vi.mock('@/api/http', () => ({ refreshAccessToken }));

const { useAttendanceSocket } = await import('@/hooks/use-socket');

/** Finds the handler `use-socket.ts` registered for a given event name. */
function handlerFor(event: string): (payload: unknown) => void {
  const call = on.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`No handler was registered for "${event}"`);
  return call[1];
}

function Probe() {
  useAttendanceSocket(true);
  return <div>probe</div>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  connect.mockClear();
  disconnect.mockClear();
  on.mockClear();
  off.mockClear();
  refreshAccessToken.mockClear();
  connected = false;
});

afterEach(() => vi.clearAllMocks());

describe('socket lifecycle under Strict Mode', () => {
  it('leaves exactly one live connection after the double mount', async () => {
    renderProbe();
    await waitFor(() => expect(connect).toHaveBeenCalled());

    // StrictMode runs the effect twice, so connect() fires twice — but the
    // interleaved cleanup disconnects the first, leaving exactly one live.
    expect(connect.mock.calls.length - disconnect.mock.calls.length).toBe(1);
    expect(connected).toBe(true);
  });

  it('removes every listener it added', async () => {
    const view = renderProbe();
    await waitFor(() => expect(on).toHaveBeenCalled());

    const listenersAdded = on.mock.calls.length;
    view.unmount();

    // Unmatched `on` calls accumulate across navigations and duplicate the feed.
    expect(off.mock.calls.length).toBe(listenersAdded);
  });

  it('holds no connection once unmounted', async () => {
    const view = renderProbe();
    await waitFor(() => expect(connect).toHaveBeenCalled());
    view.unmount();

    await waitFor(() => {
      expect(connect.mock.calls.length - disconnect.mock.calls.length).toBe(0);
    });
    expect(connected).toBe(false);
  });

  it('subscribes to the attendance event by its contract name', async () => {
    renderProbe();
    await waitFor(() => expect(on).toHaveBeenCalled());
    const events = on.mock.calls.map((call) => call[0]);
    expect(events).toContain('attendance:new');
    expect(events).toContain('connect');
    expect(events).toContain('disconnect');
  });
});

/**
 * M4: a stale access token used to leave the live feed dead until a full
 * reload — the server rejects the handshake with SOCKET_AUTH_FAILURE_MESSAGE
 * every retry, and nothing ever refreshed the token socket.io kept resending.
 */
describe('socket reconnection after an expired access token', () => {
  it('refreshes the access token when the handshake is rejected as invalid credentials', async () => {
    renderProbe();
    await waitFor(() => expect(on).toHaveBeenCalledWith('connect_error', expect.any(Function)));

    act(() => handlerFor('connect_error')(new Error('invalid credentials')));

    await waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(1));
  });

  it('does not refresh on a plain network-drop connect_error', async () => {
    renderProbe();
    await waitFor(() => expect(on).toHaveBeenCalledWith('connect_error', expect.any(Function)));

    act(() => handlerFor('connect_error')(new Error('websocket error')));

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
