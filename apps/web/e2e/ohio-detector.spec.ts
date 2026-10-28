/**
 * The real Ohio situation without A2: real API, a scripted provider that behaves like the detector
 * (allow_open false, OCCUPIED/UNCERTAIN only, eight cameras reporting one at a time, ~18 s cycle,
 * 30 s stale window). Expected: an honest occupied-only state and per-space ages, never "full" or "1 s".
 */
import { expect, test } from '@playwright/test';
import { APP } from './fixtures.ts';

test('occupied-only detection with spaces of different ages', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto(APP);
  await expect(page.getByTestId('open-disabled')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('open-disabled-line')).toBeVisible();
  await expect(page.getByTestId('watch')).toHaveCount(0);
  // After a full round robin, the oldest current view is well past 12 s: the label says so.
  await expect(page.getByTestId('prov-aging')).toHaveText(/^Camera views \d+–(1[3-9]|2\d) s old$/, { timeout: 45_000 });
  await expect(page.getByText(/^Live · 1 s$/)).toHaveCount(0);

  await page.getByTestId('view-garage').click();
  await expect(page.getByTestId('site-disclaimer')).toContainText('Not an official or exact digital twin');
  await expect(page.getByTestId('open-disabled-card')).toBeVisible();
  await expect(page.getByTestId('advice')).toHaveCount(0);
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(72);
  await expect(page.locator('[data-bay][aria-disabled=false]')).toHaveCount(0);
  await expect(page.locator('[data-bay][data-state=open]')).toHaveCount(0);
  // Each space reports its own age: some camera's spaces are always older than 12 s.
  const ages: number[] = [];
  for (const id of ['A1', 'A10', 'B1', 'B10', 'C1', 'C10', 'D1', 'D10']) {
    await page.locator(`[data-bay=${id}]`).click({ force: true });
    const note = await page.getByTestId('bay-note').textContent();
    const m = /seen (\d+) s ago/.exec(note ?? '');
    if (m) ages.push(Number(m[1]));
  }
  expect(ages.length).toBeGreaterThanOrEqual(6);
  expect(Math.max(...ages) - Math.min(...ages)).toBeGreaterThanOrEqual(6);
});
