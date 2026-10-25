/**
 * Browser checks of the Ohio Union North Garage-inspired simulation against the RUNNING stack
 * (npm run demo:ohio; other ports via PARKRIGHT_DEMO_*_PORT). Real A2, real API, real WebSocket.
 *   npx playwright test -c scripts/showcase/playwright.config.ts ohio
 */
import { expect, test, type Page } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_API_PORT ?? 8400}`;
const SIM = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_SIM_PORT ?? 5181}`;
const WEB = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_WEB_PORT ?? 5180}`;
const CAMS = ['cam-01', 'cam-02', 'cam-03', 'cam-04', 'cam-05', 'cam-06', 'cam-07', 'cam-08'];
type W = { __showcase: { lab: any; streamer: any }; __uploads: { camera: string; names: string[]; metadata: string; head: number[] }[] };

test.describe.configure({ mode: 'serial' });

async function recordUploads(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as W;
    w.__uploads = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const m = /\/api\/v1\/cameras\/([^/]+)\/frames$/.exec(url);
      if (m && init?.body instanceof FormData) {
        const img = init.body.get('image') as Blob;
        const meta = init.body.get('metadata');
        w.__uploads.push({ camera: m[1]!, names: [...init.body.keys()], metadata: meta instanceof Blob ? await meta.text() : String(meta), head: [...new Uint8Array(await img.slice(0, 3).arrayBuffer())] });
      }
      return original(input, init);
    };
  });
}

async function open(page: Page, query: string) {
  await page.goto(`${SIM}/?sim=ohio-union&${query}`);
  await page.waitForSelector('body[data-lab-ready="1"]');
  await page.waitForFunction(() => (window as unknown as W).__showcase.streamer.ready, null, { timeout: 120_000 });
}

test('72 bays and eight CCTV cameras stream real frames through A2; uploads carry no ground truth', async ({ page, request }) => {
  await recordUploads(page);
  await open(page, 'scenario=live&env=day&view=observer');
  await expect(page.locator('.sc-app')).toHaveAttribute('data-site', 'ohio-union');
  await expect(page.getByTestId('site-title')).toHaveText('Ohio Union North Garage-inspired simulation');
  await expect(page.getByTestId('site-disclaimer')).toContainText('Not an official or exact digital twin');
  await page.getByTestId('truth-toggle').check(); // development view on: must change nothing uploaded
  await expect(page.locator('[data-testid=garage-map] [data-bay]')).toHaveCount(72);
  for (const cam of CAMS) await expect(page.getByTestId(`view-${cam}`)).toBeVisible();
  // One full round robin of the eight cameras.
  await expect.poll(async () => page.evaluate(() => [...(window as unknown as W).__showcase.streamer.streams.values()].filter((s: any) => s.accepted > 0).length), { timeout: 150_000 }).toBe(8);
  const uploads = await page.evaluate(() => (window as unknown as W).__uploads);
  expect(new Set(uploads.map((u) => u.camera))).toEqual(new Set(CAMS));
  for (const u of uploads) {
    expect([...u.names].sort()).toEqual(['image', 'metadata']);
    const meta = JSON.parse(u.metadata);
    expect(Object.keys(meta).sort()).toEqual(['camera_id', 'captured_at', 'seq', 'session_id', 'sim_time_ms']);
    expect(meta.camera_id).toBe(u.camera);
    expect(u.head).toEqual([0xff, 0xd8, 0xff]);
  }
  const status = await (await request.get(`${API}/api/v1/demo/status`)).json();
  expect(status.site.site_id).toBe('ohio-union');
  expect(status.perception.allow_open).toBe(false);
  expect(status.camera.open).toEqual([]);
  expect(status.cameras).toHaveLength(8);
  for (const c of status.cameras) expect(c.last_frame, c.camera_id).not.toBeNull();
});

test('each CCTV view shows its own half-row polygons; observer quick views work', async ({ page }) => {
  await open(page, 'scenario=nearly-full&env=day&view=cam-01&stream=0');
  for (const cam of ['cam-01', 'cam-06', 'cam-08']) {
    await page.getByTestId(`view-${cam}`).click();
    const view = page.getByTestId(`cctv-${cam}`);
    await expect(view.locator('.sc-poly')).toHaveCount(9, { timeout: 30_000 });
    await expect(view.locator('figcaption')).toContainText(cam.toUpperCase());
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByTestId('view-observer').click();
  for (const v of ['Drive aisle', 'Spine', 'Ramp', 'Entrance', 'Overview']) {
    await page.getByTestId(`quick-${v}`).click();
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId('observer-view')).toContainText('Observer · not sent to ParkRight');
  expect(errors).toEqual([]);
});

test('scenario and lighting selectors change traffic and the image', async ({ page }) => {
  await open(page, 'scenario=live&env=day&stream=0');
  const sched = () => page.evaluate(() => JSON.stringify((window as unknown as W).__showcase.lab.world.schedule.events.slice(0, 5)));
  const live = await sched();
  await page.getByTestId('scenario-select').selectOption('pass-through');
  await expect(page).toHaveURL(/scenario=pass-through/);
  await expect(page).toHaveURL(/site=ohio-union/);
  expect(await sched()).not.toBe(live);
  const brightness = async () => page.evaluate(() => {
    const { lab } = (window as unknown as W).__showcase;
    lab.render('cam-05');
    const g = document.createElement('canvas').getContext('2d')!;
    g.canvas.width = 160; g.canvas.height = 90;
    g.drawImage(lab.canvas('cam-05'), 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
    return s / (d.length / 4) / 3;
  });
  const day = await brightness();
  await page.getByTestId('preset-select').selectOption('night');
  expect(await brightness()).toBeLessThan(day);
});

test('driver page names the site as an inspired simulation and updates over WebSocket', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const sim = await ctx.newPage();
  await open(sim, 'scenario=morning-rush&env=day&view=cam-02');
  const driver = await ctx.newPage();
  await driver.goto(`${WEB}/?record=1`);
  await expect(driver.getByTestId('live-garage')).toBeVisible({ timeout: 30_000 });
  await expect(driver.getByTestId('live-garage')).toHaveAttribute('data-site', 'ohio-union');
  await expect(driver.getByTestId('live-title')).toHaveText('Ohio Union North Garage-inspired simulation · live');
  await expect(driver.getByTestId('site-disclaimer')).toContainText('Not an official or exact digital twin');
  await expect(driver.getByTestId('live-total')).toHaveText('72');
  await expect(driver.locator('[data-testid=live-map] [data-bay]')).toHaveCount(72);
  // The live count is not attached to the Tuttle row: the live garage is not Tuttle.
  await expect(driver.getByTestId('tuttle-live')).toHaveCount(0);
  await expect(driver.locator('.d-cam-tabs button')).toHaveCount(8);
  const first = Number(await driver.locator('.demo').getAttribute('data-updates'));
  await expect.poll(async () => Number(await driver.locator('.demo').getAttribute('data-updates')), { timeout: 90_000 }).toBeGreaterThan(first + 3);
  await expect(driver.getByTestId('live-open')).toHaveText('0');
  // The recommendation keeps the product's freshness rule (evidence <= 12 s old). Eight cameras on
  // one CPU A2 refresh each bay only every ~18 s here, so it refuses rather than use stale evidence;
  // on a faster machine it returns the demo answer. It never offers a simulated Ohio bay.
  await driver.getByTestId('find-parking').click();
  const result = driver.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 20_000 });
  const text = await result.textContent();
  expect(text).toMatch(/No confirmed parking right now|Level 2 · Space B12/);
  await ctx.close();
});
