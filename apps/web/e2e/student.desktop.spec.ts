/** The core journey on a desktop browser, with the app in its centred device frame. */
import { expect, test } from '@playwright/test';

test('search, open, save and navigate on desktop', async ({ page }) => {
  const seen: string[] = [];
  page.on('pageerror', (e) => seen.push(String(e)));
  await fetch('http://127.0.0.1:8437/__test/reset', { method: 'POST' });
  await page.goto('/app/?splash=off');
  await page.getByTestId('search').getByRole('button').first().click();
  await page.getByTestId('search-input').fill('deck');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('garage-title')).toHaveText('Meridian Two-Level Demo Deck');
  await page.getByTestId('fav-demo-deck').click();
  await expect(page.getByTestId('directions')).toHaveAttribute('href', /maps/);
  await page.getByTestId('choose-space').click();
  await page.getByTestId('level-L2').click();
  await expect(page.locator('[data-bay=C1]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(seen).toEqual([]);
});
