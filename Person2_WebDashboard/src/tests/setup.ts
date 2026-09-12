import '@testing-library/jest-dom/vitest';

/** Deterministic clock so timezone assertions cannot drift with the CI runner. */
process.env.TZ = 'UTC';
process.env.VITE_DEMO_MODE = '1';

/**
 * jsdom has no ResizeObserver (it does no real layout), but recharts'
 * <ResponsiveContainer> — used by TrendBars, lazy-loaded from PresentNowTile —
 * constructs one unconditionally on mount. Without this stub, any test that
 * renders the dashboard hero tile crashes with a ReferenceError, unrelated to
 * whatever the test actually asserts (found writing M5's dashboard render
 * test, master audit).
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
