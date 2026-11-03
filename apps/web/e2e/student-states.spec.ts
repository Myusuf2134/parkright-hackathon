/** States the demo stack doesn't produce on its own: a physical camera with no validated occupancy, an API that is down. */
import { expect, test } from '@playwright/test';
import { APP, Backend } from './fixtures.ts';

const physical = {
  facility_id: 'lorex-lab', name: 'Meridian Lorex Camera Validation', address: null, location: null, is_simulated: false, updated_at: null,
  levels: [{ level_id: 'lab', name: 'Unsurveyed camera test', ordinal: 0, facility_id: 'lorex-lab' }],
  cameras: [{ camera_id: 'lorex-01', facility_id: 'lorex-lab', level_id: 'lab', name: 'Lorex E893AB-Z', kind: 'physical', online: true, last_frame_at: new Date().toISOString() }],
  counts: { total: 0, open: 0, occupied: 0, uncertain: 0 },
};

test('a physical camera with no validated spaces is never shown as availability', async ({ page }) => {
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path === '/api/v1/facilities') return r.fulfill({ json: [physical] });
    if (path === '/api/v1/health') return r.fulfill({ json: { status: 'ok', perception: { provider: 'a2', version: '1' } } });
    return r.fulfill({ status: 404, json: {} });
  });
  await page.routeWebSocket(/realtime/, (ws) => ws.send(JSON.stringify({ type: 'facility_snapshot', facility: physical, spaces: [] })));
  await page.goto(APP);
  await expect(page.getByTestId('unavailable-peek')).toContainText('Availability not available');
  await expect(page.getByTestId('go')).toHaveCount(0);
  await page.getByTestId('view-garage').click();
  await expect(page.getByTestId('unavailable-card')).toContainText("can't report availability");
  await expect(page.getByTestId('choose-space')).toHaveCount(0);
  await expect(page.getByTestId('location')).toContainText('Unavailable');
});

test('backend down from the start: says so, stays usable, recovers by itself', async ({ page }) => {
  const be = new Backend(page, undefined, { scenario: true });
  await be.install();
  be.disconnect();
  await page.goto(APP);
  await expect(page.getByText("Can't reach Meridian")).toBeVisible({ timeout: 12000 });
  await page.getByTestId('search').getByRole('button').first().click();
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.keyboard.press('Escape');
  be.reconnect();
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 15000 });
});

test('reconnecting keeps search available and offers nothing', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto(APP);
  await expect(page.getByTestId('open-count')).toHaveText('7');
  be.disconnect();
  await expect(page.getByTestId('reconnecting')).toBeVisible();
  await expect(page.getByTestId('search')).toBeVisible();
  await expect(page.getByTestId('open-count')).toHaveText('—');
});

test('multi-level plan comes from the facility, with a floor switch only when levels exist', async ({ page }) => {
  const be = new Backend(page);
  await be.install();
  await page.goto(`${APP}&sheet=space`);
  await expect(page.locator('[data-bay]').first()).toBeVisible();
  await expect(page.locator('[data-testid^=level-]')).toHaveCount(0);
});

test('the installable shell is declared', async ({ request }) => {
  const m = await (await request.get('/app/manifest.webmanifest')).json();
  expect(m).toMatchObject({ name: 'Meridian', display: 'standalone', scope: '/app/' });
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  const sw = await (await request.get('/app/sw.js')).text();
  expect(sw).toContain("startsWith('/api/')");
});
