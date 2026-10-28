/** One story across the split: the camera changes a space → the API state → the student app and the AI view. */
import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8434';
const post = (path: string, body: unknown) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

test.afterEach(async () => { await post('/__test/states', { A1: 'OPEN' }); });

test('a space change reaches both sides of the split', async ({ page }) => {
  test.setTimeout(60_000);
  await post('/__test/states', { A1: 'OPEN' });
  await page.goto('/present/');
  const app = page.frameLocator('[data-testid=pz-app]');
  await expect(app.getByTestId('open-count')).toHaveText('27', { timeout: 15_000 });
  await expect(page.getByTestId('pz-m-open')).toContainText('27');

  await post('/__test/states', { A1: 'OCCUPIED' });
  await expect(app.getByTestId('open-count')).toHaveText('26', { timeout: 10_000 });
  await expect(page.getByTestId('pz-m-open')).toContainText('26');
  await expect(page.getByTestId('pz-events')).toContainText('A1 → Occupied');
  await expect(page.getByTestId('pz-sync')).toContainText('A1 → Occupied');
  await expect(page.locator('.pz-map [data-bay=A1]')).toHaveAttribute('data-state', 'occupied');
  await expect(page.getByTestId('pz-m-lat')).not.toContainText('—');
});
