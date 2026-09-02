/**
 * DHAKA DAY-BOUNDARY SUITE
 *
 * Bangladesh is UTC+6, so a Dhaka calendar day starts at 18:00Z the previous
 * day. Building a range with a naive local Date silently drops the last six
 * hours of check-ins — every evening shift disappears from "today". These tests
 * pin the conversion.
 */
import { describe, expect, it } from 'vitest';
import {
  dhakaDayEndUtc,
  dhakaDayStartUtc,
  formatDate,
  formatTime,
  isLateArrival,
  lastNDhakaDateKeys,
  toDhakaDateKey,
} from '@/lib/tz';

describe('Dhaka day boundaries', () => {
  it('starts a Dhaka day at 18:00Z the previous day', () => {
    expect(dhakaDayStartUtc('2026-07-25').toISOString()).toBe('2026-07-24T18:00:00.000Z');
  });

  it('ends a Dhaka day just before 18:00Z the same day', () => {
    expect(dhakaDayEndUtc('2026-07-25').toISOString()).toBe('2026-07-25T17:59:59.999Z');
  });

  it('keeps a 23:30 Dhaka check-in inside the same Dhaka day', () => {
    // 23:30 Dhaka on 25 July is 17:30Z on 25 July.
    const lateEvening = '2026-07-25T17:30:00.000Z';
    expect(toDhakaDateKey(lateEvening)).toBe('2026-07-25');
    expect(new Date(lateEvening) <= dhakaDayEndUtc('2026-07-25')).toBe(true);
    expect(new Date(lateEvening) >= dhakaDayStartUtc('2026-07-25')).toBe(true);
  });

  it('assigns a 00:30 Dhaka check-in to the new Dhaka day', () => {
    // 00:30 Dhaka on 25 July is 18:30Z on 24 July.
    expect(toDhakaDateKey('2026-07-24T18:30:00.000Z')).toBe('2026-07-25');
  });
});

describe('formatting is timezone-pinned', () => {
  it('renders the Dhaka wall-clock time, not the runner time', () => {
    // 03:02Z is 09:02 in Dhaka — the time in wireframe Fig 3.4.
    expect(formatTime('2026-07-25T03:02:00.000Z')).toBe('09:02 AM');
  });

  it('renders the Dhaka calendar date', () => {
    expect(formatDate('2026-07-25T03:02:00.000Z')).toBe('25 Jul 2026');
  });

  it('produces identical output regardless of process timezone', () => {
    const original = process.env.TZ;
    const iso = '2026-07-25T03:02:00.000Z';
    const asUtc = formatTime(iso);
    process.env.TZ = 'America/New_York';
    expect(formatTime(iso)).toBe(asUtc);
    process.env.TZ = original;
  });
});

describe('late arrivals', () => {
  it('treats 09:02 Dhaka as on time', () => {
    expect(isLateArrival('2026-07-25T03:02:00.000Z')).toBe(false);
  });

  it('treats 09:40 Dhaka as late', () => {
    expect(isLateArrival('2026-07-25T03:40:00.000Z')).toBe(true);
  });
});

describe('date key ranges', () => {
  it('returns the requested number of days, oldest first', () => {
    const keys = lastNDhakaDateKeys(7, new Date('2026-07-25T03:00:00.000Z'));
    expect(keys).toHaveLength(7);
    expect(keys[6]).toBe('2026-07-25');
    expect(keys[0]).toBe('2026-07-19');
  });
});
