import {
  dhakaDayStartUtc,
  dhakaDayEndUtc,
  todayDhakaKey,
  toDhakaDateKey,
  isLateArrival,
  lastNDhakaDateKeys,
  lastNDaysRangeUtc,
} from '@/utils/tz';

describe('tz utils', () => {
  it('computes the Dhaka day start as 18:00Z the previous day (UTC+6)', () => {
    const start = dhakaDayStartUtc('2026-07-25');
    expect(start.toISOString()).toBe('2026-07-24T18:00:00.000Z');
  });

  it('computes the Dhaka day end just before the next day starts', () => {
    const end = dhakaDayEndUtc('2026-07-25');
    expect(end.toISOString()).toBe('2026-07-25T17:59:59.999Z');
  });

  it('keeps a 23:30-Dhaka check-in inside the same Dhaka calendar day', () => {
    // 23:30 Dhaka on 2026-07-25 is 17:30 UTC the same day.
    const lateCheckin = new Date('2026-07-25T17:30:00.000Z');
    expect(toDhakaDateKey(lateCheckin)).toBe('2026-07-25');
  });

  it('does not drop an evening check-in from "today" (the off-by-six-hours bug)', () => {
    // 23:00 UTC on 2026-07-25 is 05:00 Dhaka on 2026-07-26 — the classic bug
    // is treating this as still "2026-07-25". Confirm it correctly rolls over.
    const lateUtc = new Date('2026-07-25T23:00:00.000Z');
    expect(toDhakaDateKey(lateUtc)).toBe('2026-07-26');
  });

  it('reports todayDhakaKey consistently with toDhakaDateKey for "now"', () => {
    const now = new Date();
    expect(todayDhakaKey(now)).toBe(toDhakaDateKey(now));
  });

  it('flags a check-in after the late-arrival cutoff', () => {
    // 09:30 Dhaka -> 03:30 UTC same day.
    const late = new Date('2026-07-25T03:30:00.000Z');
    expect(isLateArrival(late, '09:15')).toBe(true);
  });

  it('does not flag a check-in before the late-arrival cutoff', () => {
    // 08:50 Dhaka -> 02:50 UTC same day.
    const onTime = new Date('2026-07-25T02:50:00.000Z');
    expect(isLateArrival(onTime, '09:15')).toBe(false);
  });

  it('lastNDhakaDateKeys returns exactly N keys, oldest first, ending on the given day', () => {
    // "now" is 12:00 Dhaka on 2026-07-25 (06:00 UTC) — comfortably mid-day,
    // no boundary ambiguity.
    const now = new Date('2026-07-25T06:00:00.000Z');
    const keys = lastNDhakaDateKeys(7, now);
    expect(keys).toHaveLength(7);
    expect(keys[keys.length - 1]).toBe('2026-07-25');
    expect(keys[0]).toBe('2026-07-19');
    // Strictly increasing, one day at a time — catches an off-by-one or a
    // stuck/duplicated day from incorrect date mutation.
    for (let i = 1; i < keys.length; i += 1) {
      const prev = new Date(`${keys[i - 1]}T00:00:00.000Z`);
      const curr = new Date(`${keys[i]}T00:00:00.000Z`);
      expect(curr.getTime() - prev.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('lastNDhakaDateKeys correctly crosses a month boundary', () => {
    // 12:00 Dhaka on 2026-08-02 (06:00 UTC) — asking for the last 7 days
    // must cross from August back into July without skipping or repeating
    // July 31st, the classic manual-date-arithmetic bug.
    const now = new Date('2026-08-02T06:00:00.000Z');
    const keys = lastNDhakaDateKeys(7, now);
    expect(keys).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('lastNDaysRangeUtc spans from the start of the oldest day to the end of the newest', () => {
    const now = new Date('2026-07-25T06:00:00.000Z');
    const range = lastNDaysRangeUtc(7, now);
    expect(range.from.toISOString()).toBe(dhakaDayStartUtc('2026-07-19').toISOString());
    expect(range.to.toISOString()).toBe(dhakaDayEndUtc('2026-07-25').toISOString());
  });
});
