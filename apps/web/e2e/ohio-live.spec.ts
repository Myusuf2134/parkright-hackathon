/** Ohio site, real API, scripted provider (OPEN allowed): 72 spaces, the site's own disclaimer, trips still work. */
import { expect, test } from '@playwright/test';
import { APP } from './fixtures.ts';

test('72-space Ohio garage: counts, disclaimer, layout and a trip through the real API', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('open-count')).toHaveText('27', { timeout: 15_000 });
  await expect(page.getByTestId('prov-live')).toBeVisible();
  await page.getByTestId('view-spaces').click();
  await expect(page.getByTestId('site-disclaimer')).toContainText('Not an official or exact digital twin');
  await expect(page.getByTestId('garage-stats')).toContainText('27');
  await expect(page.getByTestId('advice')).toContainText('Local fallback', { timeout: 10_000 });
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(72);
  await expect(page.locator('[data-bay][aria-disabled=false]')).toHaveCount(27);
  await expect(page.getByTestId('chosen-age')).toHaveText(/^Open · seen \d+ s ago$/);
  await page.getByTestId('go-space').click();
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'ok');
  await expect(page.getByTestId('trip-age')).toHaveText(/^Live · seen \d+ s ago$/);
});
