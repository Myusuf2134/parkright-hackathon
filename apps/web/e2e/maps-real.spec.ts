/** The real basemap and the real directions service, with the browser's geolocation walking the returned route. */
import { expect, test } from '@playwright/test';

const shots = process.env.MERIDIAN_SHOTS;
// Shared public servers cut off bursts, so this suite goes slowly.
test.beforeEach(async () => { await new Promise((r) => setTimeout(r, 20_000)); });

const START = { latitude: 40.0105, longitude: -83.03, accuracy: 10 };

test('real tiles, a real route to a real garage, and guidance that follows the GPS', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let tiles = 0;
  page.on('response', (r) => { if (r.url().includes('tiles.openfreemap.org') && r.ok() && /\.pbf|\/planet\//.test(r.url())) tiles++; });
  const routeBody = page.waitForResponse((r) => r.url().includes('routing.openstreetmap.de/routed-car'), { timeout: 40_000 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(START);
  await page.goto('/app/?splash=off');
  await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'yes', { timeout: 30_000 });
  await expect.poll(() => tiles, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('user-location')).toBeAttached();
  await page.waitForTimeout(1500);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-home.png` });

  await page.getByTestId('search').getByRole('button').first().click();
  await page.getByTestId('search-input').fill('dreese');
  await page.getByTestId('search-input').press('Enter');
  await page.getByTestId('all-garages').click();
  await expect(page.getByTestId('row-walk').first()).toContainText('min walk', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Close garage list' }).click();
  await page.getByTestId('destination-route').click();
  const body = await (await routeBody).json();
  const route = body.routes[0];
  await expect(page.getByTestId('route-time').first()).toHaveText(`${Math.round(route.duration / 60)} min`, { timeout: 20_000 });
  await expect(page.getByTestId('route-traffic').first()).toContainText('Live traffic not included');
  await expect(page.getByTestId('walk-leg')).toContainText('Dreese Laboratories', { timeout: 20_000 });
  await page.waitForTimeout(1800);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-route.png` });

  await page.getByTestId('start-nav').click();
  const coords: [number, number][] = route.geometry.coordinates;
  await expect(page.getByTestId('nav-instruction')).toHaveText(/\S/);
  const first = await page.getByTestId('nav-remaining').textContent();
  for (const f of [0.35, 0.6, 0.85]) {
    const [lng, lat] = coords[Math.floor(coords.length * f)];
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
    await page.waitForTimeout(1500);
  }
  await expect(page.getByTestId('nav-remaining')).not.toHaveText(first!);
  await page.waitForTimeout(1200);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-nav.png` });
  const [lng, lat] = coords.at(-1)!;
  await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
  await page.waitForTimeout(1000);
  await context.setGeolocation({ latitude: lat, longitude: lng + 0.00001, accuracy: 8 });
  await expect(page.getByTestId('at-garage')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('start-walk').click();
  await expect(page.getByTestId('nav-instruction')).toHaveText(/\S/, { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('Ohio Union to Union North to the Stadium, on the live service', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/app/?splash=off');
  await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'yes', { timeout: 30_000 });
  await page.getByTestId('search').getByRole('button').first().click();
  await page.getByTestId('search-input').fill('ohio stadium');
  await page.getByTestId('search-input').press('Enter');
  await page.getByTestId('all-garages').click();
  await page.getByTestId('garage-row-ohio-union-sim').getByRole('button').first().click();
  await page.getByTestId('route-to-garage').click();
  await page.getByTestId('origin-select').selectOption('Ohio Union');
  await expect(page.getByTestId('walk-leg')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('drive-end')).toContainText('west vehicle entrance');
  await expect(page.getByTestId('walk-start')).toContainText('pedestrian door');
  await expect(page.getByTestId('route-parking-source')).toContainText('Simulated');
  await page.waitForTimeout(2200);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-union-north.png` });
  expect(errors).toEqual([]);
});

test('the dark map loads and the desktop layout holds', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('parkright.prefs.v1', JSON.stringify({ mapTheme: 'dark' })));
  await page.goto('/app/?splash=off');
  await expect(page.getByTestId('map')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('map')).toHaveAttribute('data-map-ready', 'yes', { timeout: 30_000 });
  await page.waitForTimeout(3500);
  if (shots) await page.screenshot({ path: `${shots}/${info.project.name}-dark-desktop.png` });
  await expect(page.getByTestId('sheet')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
