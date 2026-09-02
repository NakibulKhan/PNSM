import { useEffect, useState } from 'react';

/**
 * True only after hydration.
 *
 * Use this for values that genuinely cannot match between server and client —
 * a live "3 minutes ago" counter, window dimensions, navigator state. Do NOT
 * use it for ordinary timestamps: those should be formatted with an explicit
 * timezone via `@/lib/tz`, which produces identical output on both sides.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
