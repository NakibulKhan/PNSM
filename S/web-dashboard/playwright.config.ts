import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests run against a PRODUCTION preview build in demo mode.
 *
 * Testing the preview rather than the dev server matters: `vite preview` serves
 * the same Rollup output that reaches CloudFront, so route-level code splitting,
 * chunking and asset paths are all exercised as deployed. The dev server would
 * hide a broken lazy import.
 */
export default defineConfig({
  testDir: './src/e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The blueprint calls out Safari layout collapse; run WebKit locally when
    // touching layout. Excluded from CI to keep the pipeline fast.
    ...(process.env.CI ? [] : [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]),
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_DEMO_MODE: '1' },
  },
});
