/**
 * Browser checks of the 34-space showcase against the RUNNING showcase stack
 * (npm run demo:showcase; other ports via PARKRIGHT_DEMO_*_PORT). Real A2, real API, real WebSocket.
 */
import { expect, test, type Page } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_API_PORT ?? 8400}`;
const SIM = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_SIM_PORT ?? 5181}`;
const WEB = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_WEB_PORT ?? 5180}`;
const CAMS = ['cam-01', 'cam-02', 'cam-03', 'cam-04'];
type W = { __showcase: { lab: any; streamer: any }; __uploads: { camera: string; names: string[]; metadata: string; head: number[]; size: number }[] };

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
        const head = [...new Uint8Array(await img.slice(0, 3).arrayBuffer())];
        w.__uploads.push({ camera: m[1]!, names: [...init.body.keys()], metadata: String(init.body.get('metadata') instanceof Blob ? await (init.body.get('metadata') as Blob).text() : init.body.get('metadata')), head, size: img.size });
      }
      return original(input, init);
    };
  });
}

async function open(page: Page, query: string) {
  await page.goto(`${SIM}/?showcase=1&sim=garage&${query}`);
  await page.waitForSelector('body[data-lab-ready="1"]');
  await page.waitForFunction(() => (window as unknown as W).__showcase.streamer.ready, null, { timeout: 120_000 });
}

test('all 34 spaces render; four CCTV cameras feed real frames through A2; uploads carry no ground truth', async ({ page, request }) => {
  await recordUploads(page);
  await open(page, 'scenario=live&env=day&view=observer');
  await page.getByTestId('truth-toggle').check(); // development view on: must change nothing uploaded
  await expect(page.locator('[data-testid=garage-map] [data-bay]')).toHaveCount(34);
  await expect(page.getByTestId('observer-view')).toContainText('Observer · not sent to ParkRight');
  // Wait for one full cycle of the four cameras.
  await expect.poll(async () => page.evaluate(() => [...(window as unknown as W).__showcase.streamer.streams.values()].filter((s: any) => s.accepted > 0).length), { timeout: 90_000 }).toBe(4);
  const uploads = await page.evaluate(() => (window as unknown as W).__uploads);
  expect(new Set(uploads.map((u) => u.camera))).toEqual(new Set(CAMS));
  for (const u of uploads) {
    expect([...u.names].sort()).toEqual(['image', 'metadata']);
    const meta = JSON.parse(u.metadata);
    expect(Object.keys(meta).sort()).toEqual(['camera_id', 'captured_at', 'seq', 'session_id', 'sim_time_ms']);
    expect(meta.camera_id).toBe(u.camera);
    expect(u.head).toEqual([0xff, 0xd8, 0xff]);
  }
  // Quick views move only the observer: no extra uploads appear because of them.
  const before = uploads.length;
  for (const v of ['Entrance', 'Row C', 'Overview']) await page.getByTestId(`quick-${v}`).click();
  const after = await page.evaluate(() => (window as unknown as W).__uploads.length);
  expect(after - before).toBeLessThanOrEqual(2);
  const status = await (await request.get(`${API}/api/v1/demo/status`)).json();
  expect(status.showcase).toBe(true);
  expect(status.perception.allow_open).toBe(false);
  expect(status.camera.open).toEqual([]);
  for (const c of status.cameras) expect(c.last_frame, c.camera_id).not.toBeNull();
});

test('CCTV selector shows each camera with owned bays, boxes, polygons and frame status', async ({ page }) => {
  await open(page, 'scenario=nearly-full&env=day&view=cam-01');
  for (const cam of CAMS) {
    await page.getByTestId(`view-${cam}`).click();
    const view = page.getByTestId(`cctv-${cam}`);
    await expect(view).toBeVisible();
    await expect(view.locator('.sc-poly')).toHaveCount(cam === 'cam-01' || cam === 'cam-04' ? 9 : 8, { timeout: 30_000 });
    await expect(view.locator('figcaption')).toContainText(cam.toUpperCase());
  }
  await expect.poll(async () => page.getByTestId('cctv-cam-04').locator('figcaption').textContent(), { timeout: 90_000 }).toMatch(/accepted · A2 \d+ ms/);
});

test('scenario and lighting selectors change traffic and the image', async ({ page }) => {
  await open(page, 'scenario=live&env=day&stream=0');
  const sched = () => page.evaluate(() => JSON.stringify((window as unknown as W).__showcase.lab.world.schedule.events.slice(0, 5)));
  const live = await sched();
  await page.getByTestId('scenario-select').selectOption('class-transition');
  await expect(page).toHaveURL(/scenario=class-transition/);
  expect(await sched()).not.toBe(live);
  expect(await page.evaluate(() => (window as unknown as W).__showcase.lab.world.simTimeMs)).toBeLessThan(1500);
  const brightness = async () => page.evaluate(() => {
    const { lab } = (window as unknown as W).__showcase;
    lab.render('cam-02');
    const c = lab.canvas('cam-02') as HTMLCanvasElement;
    const g = document.createElement('canvas').getContext('2d')!;
    g.canvas.width = 160; g.canvas.height = 90;
    g.drawImage(c, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
    return s / (d.length / 4) / 3;
  });
  const day = await brightness();
  await page.getByTestId('preset-select').selectOption('night');
  await expect(page).toHaveURL(/env=night/);
  expect(await brightness()).toBeLessThan(day);
});

test('driver page updates over WebSocket without refresh: counts, map and event feed', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const sim = await ctx.newPage();
  await open(sim, 'scenario=morning-rush&env=day&view=cam-02');
  const driver = await ctx.newPage();
  await driver.goto(`${WEB}/?record=1`);
  await expect(driver.getByTestId('live-garage')).toBeVisible({ timeout: 30_000 });
  await expect(driver.getByTestId('live-total')).toHaveText('34');
  await expect(driver.getByTestId('tuttle-live')).toContainText('Simulated garage · live perception');
  await expect(driver.locator('[data-testid=live-map] [data-bay]')).toHaveCount(34);
  const first = Number(await driver.locator('.demo').getAttribute('data-updates'));
  await expect.poll(async () => Number(await driver.locator('.demo').getAttribute('data-updates')), { timeout: 60_000 }).toBeGreaterThan(first + 3);
  await expect(driver.getByTestId('event-feed').locator('li em').first()).toBeVisible({ timeout: 60_000 });
  await expect(driver.getByTestId('live-open')).toHaveText('0');
  // The recommendation remains a separate action and stays grounded.
  await driver.getByTestId('find-parking').click();
  await expect(driver.getByTestId('result-space')).toHaveText('Level 2 · Space B12');
  await ctx.close();
});

test('presentation and engineering modes', async ({ page }) => {
  await open(page, 'scenario=live&env=dusk&present=1&stream=0');
  await expect(page.locator('.sc-app')).toHaveAttribute('data-mode', 'present');
  await expect(page.getByTestId('engineering-panel')).toHaveCount(0);
  await expect(page.getByTestId('mode-toggle')).toHaveText('Engineering view');
  await expect(page.getByTestId('facility-counts')).toBeVisible();
  await page.getByTestId('mode-toggle').click();
  await expect(page.locator('.sc-app')).toHaveAttribute('data-mode', 'engineering');
  await expect(page.getByTestId('engineering-panel')).toBeVisible();
  await expect(page.getByTestId('engineering-panel')).toContainText('Ground truth (development only)');
});
