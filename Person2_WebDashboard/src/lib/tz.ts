/**
 * Dhaka-time formatting and day boundaries.
 *
 * TWO BUGS THIS FILE PREVENTS
 * ---------------------------
 * 1. Hydration mismatch. If the server formats a date with its own locale and
 *    the browser formats it with the user's, React sees different HTML and
 *    throws. Pinning the timezone AND the locale on both sides makes the
 *    output byte-identical.
 * 2. The off-by-six-hours bug. Dhaka is UTC+6, so "today" locally starts at
 *    18:00Z the previous day. Querying with a naive `new Date()` day boundary
 *    silently drops the last six hours of check-ins.
 */
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE } from './constants';

/** "25 Jul 2026, 09:02 AM" */
export function formatDateTime(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'dd MMM yyyy, hh:mm a');
}

/** "09:02 AM" */
export function formatTime(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'hh:mm a');
}

/** "25 Jul 2026" */
export function formatDate(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'dd MMM yyyy');
}

/** "2026-07-25" — the machine-readable Dhaka calendar date. */
export function toDhakaDateKey(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'yyyy-MM-dd');
}

/** "Sat" */
export function formatWeekdayShort(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'EEE');
}

/**
 * Start of a Dhaka calendar day, expressed as a UTC instant.
 * `dateKey` is "YYYY-MM-DD" as a human in Dhaka would write it.
 */
export function dhakaDayStartUtc(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00`, APP_TIMEZONE);
}

/** End of a Dhaka calendar day (inclusive), as a UTC instant. */
export function dhakaDayEndUtc(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T23:59:59.999`, APP_TIMEZONE);
}

/** Today's Dhaka calendar date, regardless of where the code is running. */
export function todayDhakaKey(now: Date = new Date()): string {
  return formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd');
}

/** A UTC range covering the whole of today in Dhaka. */
export function todayDhakaRangeUtc(now: Date = new Date()): { from: string; to: string } {
  const key = todayDhakaKey(now);
  return { from: dhakaDayStartUtc(key).toISOString(), to: dhakaDayEndUtc(key).toISOString() };
}

/** The last `days` Dhaka calendar dates, oldest first, including today. */
export function lastNDhakaDateKeys(days: number, now: Date = new Date()): string[] {
  const zoned = toZonedTime(now, APP_TIMEZONE);
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(zoned);
    day.setDate(day.getDate() - offset);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    keys.push(`${yyyy}-${mm}-${dd}`);
  }
  return keys;
}

/** UTC range covering the last `days` Dhaka days, ending at end-of-today. */
export function lastNDaysRangeUtc(days: number, now: Date = new Date()) {
  const keys = lastNDhakaDateKeys(days, now);
  return {
    from: dhakaDayStartUtc(keys[0]).toISOString(),
    to: dhakaDayEndUtc(keys[keys.length - 1]).toISOString(),
  };
}

/**
 * "12 minutes ago". Client-only: the result changes every minute, so rendering
 * it on the server guarantees a hydration mismatch. Components using this must
 * render an absolute time until mounted.
 */
export function relativeFromNow(iso: string | Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/** Late-arrival rule: a check-in after this Dhaka wall-clock time is late. */
export const LATE_ARRIVAL_CUTOFF = '09:15';

export function isLateArrival(iso: string | Date, cutoff = LATE_ARRIVAL_CUTOFF): boolean {
  const hhmm = formatInTimeZone(new Date(iso), APP_TIMEZONE, 'HH:mm');
  return hhmm > cutoff;
}
