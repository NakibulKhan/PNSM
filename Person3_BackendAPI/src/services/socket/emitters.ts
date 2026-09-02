/**
 * Thin wrappers around the four events Person 2's admin app listens for.
 * Every payload must carry `_id` — they dedupe on it to survive Strict-Mode
 * double-mount and reconnect replay (architecture report §8). Send the
 * complete object, not just an id, so their feed renders without a
 * follow-up fetch. Not wired into any route yet in this phase (no
 * attendance/leave routes exist until a later phase) — these exist now so
 * the Socket.IO foundation is complete and ready to call from Phase 4+.
 */
import { getSocketServer, isSocketServerInitialized } from './socketServer';
import { SOCKET_EVENTS } from '../../constants';
import { logger } from '../../utils/logger';

function emit(event: string, payload: Record<string, unknown>): void {
  if (!isSocketServerInitialized()) {
    logger.warn('Socket.IO not initialized — dropping event', { event });
    return;
  }
  if (payload._id === undefined) {
    // Never silently emit a payload the admin client can't dedupe.
    throw new Error(`Socket event "${event}" payload is missing _id`);
  }
  getSocketServer().emit(event, payload);
}

export function emitAttendanceNew(attendanceLog: Record<string, unknown>): void {
  emit(SOCKET_EVENTS.attendanceNew, attendanceLog);
}

export function emitAttendanceFlagged(attendanceLog: Record<string, unknown>): void {
  emit(SOCKET_EVENTS.attendanceFlagged, attendanceLog);
}

export function emitSpoofAlert(alert: Record<string, unknown>): void {
  emit(SOCKET_EVENTS.spoofAlert, alert);
}

export function emitNotificationNew(notification: Record<string, unknown>): void {
  emit(SOCKET_EVENTS.notificationNew, notification);
}
