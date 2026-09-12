import { deriveWeekLabel, parseWeekLabel } from '@/utils/shiftDays';

describe('deriveWeekLabel (ADR-3)', () => {
  it('derives "Sun-Thu" from the Bangladesh business week', () => {
    expect(deriveWeekLabel([0, 1, 2, 3, 4])).toBe('Sun-Thu');
  });

  it('derives "Mon-Fri" from a Western business week', () => {
    expect(deriveWeekLabel([1, 2, 3, 4, 5])).toBe('Mon-Fri');
  });

  it('handles unsorted input identically to sorted input', () => {
    expect(deriveWeekLabel([4, 1, 3, 0, 2])).toBe(deriveWeekLabel([0, 1, 2, 3, 4]));
  });

  it('derives a single-day label without a range dash', () => {
    expect(deriveWeekLabel([3])).toBe('Wed');
  });

  it('derives "Every day" for all seven days', () => {
    expect(deriveWeekLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });

  it('falls back to a comma list for a non-contiguous set', () => {
    expect(deriveWeekLabel([0, 2, 4])).toBe('Sun, Tue, Thu');
  });

  it('derives a wraparound range across the week boundary (e.g. Fri-Sat-Sun)', () => {
    expect(deriveWeekLabel([5, 6, 0])).toBe('Fri-Sun');
  });

  it('handles a two-day wraparound run (Sat-Sun)', () => {
    expect(deriveWeekLabel([6, 0])).toBe('Sat-Sun');
  });

  it('returns an empty string for no days at all', () => {
    expect(deriveWeekLabel([])).toBe('');
  });
});

describe('parseWeekLabel (DECISIONS.md N6 — the admin write-boundary inverse of deriveWeekLabel)', () => {
  it('round-trips every shape deriveWeekLabel can produce', () => {
    const cases = [
      [0, 1, 2, 3, 4],
      [1, 2, 3, 4, 5],
      [3],
      [0, 1, 2, 3, 4, 5, 6],
      [0, 2, 4],
      [5, 6, 0],
      [6, 0],
    ];
    for (const days of cases) {
      const label = deriveWeekLabel(days);
      expect(parseWeekLabel(label).sort((a, b) => a - b)).toEqual([...days].sort((a, b) => a - b));
    }
  });

  it('parses "Sun-Thu" directly', () => {
    expect(parseWeekLabel('Sun-Thu')).toEqual([0, 1, 2, 3, 4]);
  });

  it('parses "Every day" as all seven days', () => {
    expect(parseWeekLabel('Every day')).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('parses a comma-separated list', () => {
    expect(parseWeekLabel('Sun, Wed, Fri').sort()).toEqual([0, 3, 5].sort());
  });

  it('parses a wraparound range (Fri-Sun)', () => {
    expect(parseWeekLabel('Fri-Sun').sort((a, b) => a - b)).toEqual([0, 5, 6].sort((a, b) => a - b));
  });

  it('throws on an unrecognised weekday', () => {
    expect(() => parseWeekLabel('Funday')).toThrow();
  });

  it('returns an empty array for an empty label', () => {
    expect(parseWeekLabel('')).toEqual([]);
  });
});
