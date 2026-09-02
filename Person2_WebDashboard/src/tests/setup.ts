import '@testing-library/jest-dom/vitest';

/** Deterministic clock so timezone assertions cannot drift with the CI runner. */
process.env.TZ = 'UTC';
process.env.VITE_DEMO_MODE = '1';
