import mongoose from 'mongoose';
import { MONGODB_URI } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);

// Registered once at module load — NOT inside connectDB() — so a retry
// after a failed connection attempt (which never sets `connected = true`)
// can't re-register the same listeners and start duplicating log lines.
mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
mongoose.connection.on('error', (err: Error) => logger.error('MongoDB connection error', err));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

let connected = false;

export async function connectDB(): Promise<typeof mongoose> {
  if (connected) return mongoose;
  await mongoose.connect(MONGODB_URI);
  connected = true;
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

/** Used by /health to report real DB status rather than assuming it's up. */
export function dbReadyState(): 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown' {
  const states: Record<number, 'disconnected' | 'connected' | 'connecting' | 'disconnecting'> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return states[mongoose.connection.readyState] ?? 'unknown';
}
