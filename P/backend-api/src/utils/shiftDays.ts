/**
 * ADR-3: `days_of_week` (0=Sun..6=Sat) is the only source of truth for a
 * Shift. `days_of_week_label` is always DERIVED from it here — never
 * hand-authored, and never parsed back into integers on read. This keeps the
 * Sun-Thu-vs-Mon-Fri question a per-deployment data value rather than an
 * assumption baked into code (see ADR-3 for why neither Person 1's Mon-Fri
 * hardcode nor an assumed Sun-Thu default is chosen here).
 */
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Finds a contiguous run on the 7-day cycle that exactly matches `days`,
 * allowing wraparound (e.g. Fri-Sat-Sun). There are only 7 possible rotations
 * to check, so this brute-forces all of them rather than trying to detect
 * wraparound with linear index arithmetic (which an earlier version of this
 * function claimed to do in its comment but didn't actually implement).
 */
function findContiguousRun(days: number[]): { start: number; end: number } | null {
  const set = new Set(days);
  const len = days.length;
  for (let start = 0; start < 7; start += 1) {
    const run = new Set<number>();
    for (let i = 0; i < len; i += 1) run.add((start + i) % 7);
    if (run.size === set.size && [...run].every((d) => set.has(d))) {
      return { start, end: (start + len - 1) % 7 };
    }
  }
  return null;
}

const WEEKDAY_INDEX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Inverse of deriveWeekLabel(), used ONLY at the admin employee-creation/
 * update route boundary (DECISIONS.md N6) — Person 2's payload sends a label
 * like "Sun-Thu", but the Shift model's source of truth is the numeric array
 * (ADR-3), which always regenerates its own label on save. This never touches
 * the Shift model itself, preserving that one-directional invariant.
 *
 * Accepts exactly the shapes deriveWeekLabel() can produce, so the two
 * functions round-trip: "Every day", a single day ("Sun"), a contiguous range
 * ("Sun-Thu"), or a comma-separated list ("Sun, Wed, Fri").
 */
export function parseWeekLabel(label: string): number[] {
  const trimmed = label.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.toLowerCase() === 'every day') return [0, 1, 2, 3, 4, 5, 6];

  const rangeMatch = /^([A-Za-z]{3})\s*-\s*([A-Za-z]{3})$/.exec(trimmed);
  if (rangeMatch) {
    const start = WEEKDAY_INDEX[rangeMatch[1].toLowerCase()];
    const end = WEEKDAY_INDEX[rangeMatch[2].toLowerCase()];
    if (start === undefined || end === undefined) {
      throw new Error(`Unrecognised weekday in range "${trimmed}"`);
    }
    const days: number[] = [];
    for (let i = start, count = 0; count < 7; i = (i + 1) % 7, count += 1) {
      days.push(i);
      if (i === end) break;
    }
    return days;
  }

  // Comma-separated list, or a single day (a one-element list).
  const days = trimmed.split(',').map((part) => {
    const key = part.trim().toLowerCase();
    const day = WEEKDAY_INDEX[key];
    if (day === undefined) throw new Error(`Unrecognised weekday "${part.trim()}" in "${trimmed}"`);
    return day;
  });
  return [...new Set(days)].sort((a, b) => a - b);
}

export function deriveWeekLabel(daysOfWeek: number[]): string {
  const sorted = [...new Set(daysOfWeek)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  if (sorted.length === 7) return 'Every day';

  const run = findContiguousRun(sorted);
  if (run) {
    const first = WEEKDAY_ABBR[run.start];
    const last = WEEKDAY_ABBR[run.end];
    return run.start === run.end ? first : `${first}-${last}`;
  }

  return sorted.map((d) => WEEKDAY_ABBR[d]).join(', ');
}
