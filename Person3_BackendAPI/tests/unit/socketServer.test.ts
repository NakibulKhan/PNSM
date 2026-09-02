import { verifySocketAuth } from '@/services/socket/socketServer';
import { signAccessToken } from '@/utils/jwt';
import { SOCKET_AUTH_FAILURE_MESSAGE } from '@/constants';
import type { Socket } from 'socket.io';

function mockSocket(token?: string): Socket {
  return {
    handshake: { auth: token !== undefined ? { token } : {} },
    data: {},
  } as unknown as Socket;
}

describe('verifySocketAuth', () => {
  it('calls next() with no error and populates socket.data.user for a valid token', () => {
    const token = signAccessToken('user-1', 'admin_hr');
    const socket = mockSocket(token);
    const next = jest.fn();

    verifySocketAuth(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toEqual({ sub: 'user-1', role: 'admin_hr' });
  });

  it('rejects with exactly "invalid credentials" when no token is present', () => {
    const socket = mockSocket(undefined);
    const next = jest.fn();

    verifySocketAuth(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0] as Error;
    // Person 2's client pattern-matches on this EXACT string to trigger a
    // token refresh + reconnect instead of retrying forever (report §8) —
    // any other wording silently breaks that recovery path.
    expect(err.message).toBe(SOCKET_AUTH_FAILURE_MESSAGE);
  });

  it('rejects with exactly "invalid credentials" for a garbage token', () => {
    const socket = mockSocket('not-a-real-jwt');
    const next = jest.fn();

    verifySocketAuth(socket, next);

    const err = next.mock.calls[0][0] as Error;
    expect(err.message).toBe(SOCKET_AUTH_FAILURE_MESSAGE);
  });

  it('does not populate socket.data.user when authentication fails', () => {
    const socket = mockSocket('garbage');
    verifySocketAuth(socket, jest.fn());
    expect(socket.data.user).toBeUndefined();
  });

  it('works identically for every role (role-agnostic per ADR-6)', () => {
    (['employee', 'admin_hr', 'super_admin'] as const).forEach((role) => {
      const token = signAccessToken('user-x', role);
      const socket = mockSocket(token);
      const next = jest.fn();
      verifySocketAuth(socket, next);
      expect(socket.data.user?.role).toBe(role);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
