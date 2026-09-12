import http from 'node:http';
import { createApp } from './app';
import { connectDB } from './config/db';
import { initSocketServer, getSocketServer, isSocketServerInitialized } from './services/socket/socketServer';
import { PORT } from './config/env';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);

  httpServer.listen(PORT, () => {
    logger.info(`PNSM backend listening on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    // Close Socket.IO first — it manages upgraded websocket connections
    // separately from the underlying HTTP server, so closing only
    // httpServer can leave those hanging rather than cleanly terminating.
    if (isSocketServerInitialized()) {
      getSocketServer().close();
    }
    httpServer.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Safety net for anything that escapes past this point (after startup
  // succeeded) — without these, an uncaught error crashes the process with
  // a raw Node trace instead of a structured log line, and a genuinely
  // unhandled rejection could otherwise go unnoticed depending on the
  // Node version's default --unhandled-rejections behavior.
  process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception — exiting', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled promise rejection', reason);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
