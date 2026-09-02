/**
 * Dhaka-time day boundaries. Mirrors Person 2's tz.ts on the backend side of
 * the same boundary — Dhaka is UTC+6, so "today" starts at 18:00Z the
 * previous day. A naive `new Date().setHours(0,0,0,0)` on the server
 * silently drops the last six hours of check-ins from "today" — see
 * architecture report §7 / Person 2's Bug Bible #6. Every "today"/"this
 * week" boundary the backend computes for KPIs, late-arrival checks, or
 * date-range queries must come from here, never from an ad hoc Date call.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { APP_TIMEZONE, DEFAULT_LATE_ARRIVAL_CUTOFF } from '../constants';

/** "2026-07-25" — the machine-readable Dhaka calendar date for a given instant. */
export function todayDhakaKey(now: Date = new Date()): string {
  return formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd');
}

export function toDhakaDateKey(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'yyyy-MM-dd');
}

/** Start of a Dhaka calendar day, as a UTC instant. `dateKey` is "YYYY-MM-DD". */
export function dhakaDayStartUtc(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00`, APP_TIMEZONE);
}

/** End of a Dhaka calendar day (inclusive), as a UTC instant. */
export function dhakaDayEndUtc(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T23:59:59.999`, APP_TIMEZONE);
}

/** UTC range covering the whole of today in Dhaka. */
export function todayDhakaRangeUtc(now: Date = new Date()): { from: Date; to: Date } {
  const key = todayDhakaKey(now);
  return { from: dhakaDayStartUtc(key), to: dhakaDayEndUtc(key) };
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

export function lastNDaysRangeUtc(days: number, now: Date = new Date()): { from: Date; to: Date } {
  const keys = lastNDhakaDateKeys(days, now);
  return { from: dhakaDayStartUtc(keys[0]), to: dhakaDayEndUtc(keys[keys.length - 1]) };
}

/** Late-arrival rule: a check-in after this Dhaka wall-clock time is late. Policy can override. */
export function isLateArrival(iso: string | Date, cutoff: string = DEFAULT_LATE_ARRIVAL_CUTOFF): boolean {
  const hhmm = formatInTimeZone(new Date(iso), APP_TIMEZONE, 'HH:mm');
  return hhmm > cutoff;
}

/** "Sun" .. "Sat" for a given ISO instant, in Dhaka local time. */
export function dhakaWeekdayShort(iso: string | Date): string {
  return formatInTimeZone(new Date(iso), APP_TIMEZONE, 'EEE');
}
