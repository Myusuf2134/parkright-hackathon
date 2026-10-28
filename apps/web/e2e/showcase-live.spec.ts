/** 34-space showcase garage, real API, scripted provider: unchanged behaviour, no site disclaimer invented. */
import { expect, test } from '@playwright/test';
import { APP } from './fixtures.ts';

test('34-space showcase: counts, layout and a trip, with no Ohio disclaimer', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('open-count')).toHaveText('13', { timeout: 15_000 });
  await expect(page.getByTestId('prov-live')).toBeVisible();
  await expect(page.getByTestId('open-disabled')).toHaveCount(0);
  await page.getByTestId('view-spaces').click();
  await expect(page.getByTestId('site-disclaimer')).toHaveCount(0);
  await expect(page.getByTestId('advice')).toContainText('Local fallback', { timeout: 10_000 });
  await page.getByTestId('choose-space').click();
  await expect(page.locator('[data-bay]')).toHaveCount(34);
  await expect(page.locator('[data-bay][aria-disabled=false]')).toHaveCount(13);
  await page.getByTestId('go-space').click();
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'ok');
});
