/**
 * Pre-demo smoke suite.
 *
 * Runs against a production preview build in demo mode, so it exercises the
 * exact Rollup output that reaches CloudFront — route-level code splitting,
 * chunk loading and asset paths included — without depending on any teammate's
 * service being awake.
 *
 *   npx playwright install chromium   # once
 *   npm run e2e
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, account: 'HR / Admin' | 'Super Admin' = 'HR / Admin') {
  await page.goto('/login');
  await page.getByRole('button', { name: account }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('PNSM Command Center', () => {
  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('HR can sign in and read the dashboard', async ({ page }) => {
    await signIn(page);
    // 'Present now' since the Bento migration — this asserted 'Checked in today'
    // (the pre-migration KPI card label) and had been silently failing, because
    // this suite had never once been executed. The underlying data field is
    // still `checkedInToday`; only the rendered label changed.
    await expect(page.getByText('Present now')).toBeVisible();
    await expect(page.getByText('Avg face match')).toBeVisible();
    await expect(page.getByRole('heading', { name: /live check-in feed/i })).toBeVisible();
  });

  /**
   * The deep-link regression. This is what breaks on CloudFront without the
   * custom error response, and it is invisible during normal navigation —
   * so the test navigates directly rather than clicking through.
   */
  test('a deep link survives a hard reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/employees');
    await page.reload();
    await expect(page).toHaveURL(/\/employees/);
    // `exact: true` matters: Playwright's `name` is a case-insensitive SUBSTRING
    // match by default, and the Bento migration added an `sr-only` <h3>"Filter
    // employees"</h3> to the filter rail. sr-only is a clip technique, not
    // display:none, so it stays in the accessibility tree and this locator
    // resolved to two elements — a strict-mode violation, not a miss.
    await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();
  });

  test('the WebGL geofence map initialises and reports coordinates', async ({ page }) => {
    await signIn(page);
    await page.goto('/geofences');
    await page.getByRole('button', { name: /Gulshan Office/ }).click();

    // MapLibre only mounts client-side; its canvas proves WebGL came up.
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Stored as GeoJSON/)).toBeVisible();
  });

  test('the attendance log renders and exports CSV', async ({ page }) => {
    await signIn(page);
    await page.goto('/attendance');
    await expect(page.getByRole('columnheader', { name: 'Employee' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    expect((await download).suggestedFilename()).toContain('.csv');
  });

  test('onboarding validates before it will submit', async ({ page }) => {
    await signIn(page);
    await page.goto('/employees/new');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByText('Enter the full name')).toBeVisible();
    await expect(page.getByText('Upload a reference photo')).toBeVisible();
  });

  /** RBAC is enforced by the API; this checks the interface stays honest. */
  test('HR cannot reach Super Admin screens, but a Super Admin can', async ({ page }) => {
    await signIn(page, 'HR / Admin');
    await page.goto('/billing');
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page, 'Super Admin');
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  });
});
