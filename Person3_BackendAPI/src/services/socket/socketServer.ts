/**
 * Socket.IO is the one browser-facing connection this backend has (REST is
 * server-to-server from Person 2's Next.js runtime — see architecture
 * report §1/§8). CORS is therefore scoped here, not on the Express app.
 */
import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { verifyAccessToken, InvalidTokenError } from '../../utils/jwt';
import { ADMIN_ALLOWED_ORIGINS } from '../../config/env';
import { SOCKET_AUTH_FAILURE_MESSAGE } from '../../constants';
import { logger } from '../../utils/logger';
import type { AuthenticatedPrincipal } from '../../types/express';

/**
 * Per-socket data, via Socket.IO's own generic type parameters rather than
 * `declare module 'socket.io' { interface Socket { data: ... } }` — Socket's
 * `data` property is declared on the class itself (from its 4th generic
 * parameter), and TS's declaration-merging rules require an augmented
 * property to match EXACTLY, not just be assignable, so re-declaring it with
 * a narrower type fails to compile. The generics are the mechanism the
 * library actually designed for this.
 */
interface SocketData {
  user?: AuthenticatedPrincipal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppSocketIOServer = SocketIOServer<any, any, any, SocketData>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppSocket = Socket<any, any, any, SocketData>;

let io: AppSocketIOServer | null = null;

/**
 * The handshake auth decision, extracted as a standalone function so it can
 * be unit-tested directly with a mock socket/next rather than only through
 * a real Socket.IO connection. Behavior is unchanged from before this
 * refactor — this is the same logic `io.use()` was given inline.
 */
export function verifySocketAuth(socket: AppSocket, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error(SOCKET_AUTH_FAILURE_MESSAGE));
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    socket.data.user = { sub: claims.sub, role: claims.role };
    next();
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      next(new Error(SOCKET_AUTH_FAILURE_MESSAGE));
      return;
    }
    next(err as Error);
  }
}

export function initSocketServer(httpServer: HttpServer): AppSocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ADMIN_ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Person 2 sends the JWT in the handshake `auth` payload, not a query
  // string, specifically so it never lands in server logs. On failure we
  // MUST use exactly this error message — their client pattern-matches on
  // it to trigger a token refresh + reconnect instead of retrying forever
  // (architecture report §8). Any other string silently breaks that
  // recovery path.
  io.use(verifySocketAuth);

  io.on('connection', (socket: AppSocket) => {
    logger.info('Socket connected', { userId: socket.data.user?.sub });
    socket.on('disconnect', (reason: string) => {
      logger.info('Socket disconnected', { userId: socket.data.user?.sub, reason });
    });
  });

  return io;
}

export function getSocketServer(): AppSocketIOServer {
  if (!io) throw new Error('Socket.IO server not initialized — call initSocketServer() first');
  return io;
}

export function isSocketServerInitialized(): boolean {
  return io !== null;
}
