/** 34-space showcase in the split demo: regression for the original garage. */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test('34-space split: both sides agree, no Ohio disclaimer', async ({ page }) => {
  await page.goto('/present/');
  const app = page.frameLocator('[data-testid=pz-app]');
  await expect(app.getByTestId('open-count')).toHaveText('13', { timeout: 15_000 });
  await expect(page.getByTestId('pz-site-title')).toHaveText('ParkRight Showcase Garage');
  await expect(page.getByTestId('pz-simulation')).toBeVisible();
  await expect(page.getByTestId('pz-disclaimer')).toHaveCount(0);
  await expect(page.getByTestId('pz-m-cameras')).toContainText('4');
  await expect(page.getByTestId('pz-m-spaces')).toContainText('34');
  await expect(page.getByTestId('pz-m-open')).toContainText('13');
  await expect(page.getByTestId('pz-open-disabled')).toHaveCount(0);
});
