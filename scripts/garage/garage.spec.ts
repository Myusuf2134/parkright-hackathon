/**
 * Browser checks of the 3D garage simulator against the running garage stack
 * (npm run demo:hackathon:garage, optionally on other ports via PARKRIGHT_DEMO_*_PORT).
 */
import { expect, test, type Page } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_API_PORT ?? 8400}`;
const SIM = `http://127.0.0.1:${process.env.PARKRIGHT_DEMO_SIM_PORT ?? 5181}`;
const FRAME_FIELDS = ['camera_id', 'captured_at', 'seq', 'session_id', 'sim_time_ms'];

test.describe.configure({ mode: 'serial' });

async function open(page: Page, query: string) {
  await page.goto(`${SIM}/?sim=garage&${query}`);
  await page.waitForSelector('body[data-lab-ready="1"]');
  await page.waitForFunction(() => (window as never as { __garageLab: { streamer: { health: { inference?: { inference_ready?: boolean } } | null } } }).__garageLab.streamer.health?.inference?.inference_ready, null, { timeout: 120_000 });
}

/** Records the exact FormData parts the simulator uploads (Playwright cannot read Blob bodies). */
async function recordUploads(page: Page) {
  await page.addInitScript(() => {
    const w = window as never as { __uploads: { names: string[]; metadata: string; image: string }[] };
    w.__uploads = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/v1/cameras/cam-01/frames') && init?.body instanceof FormData) {
        const names = [...init.body.keys()];
        const meta = init.body.get('metadata');
        const img = init.body.get('image') as Blob;
        const bytes = new Uint8Array(await img.arrayBuffer());
        let bin = '';
        for (const x of bytes) bin += String.fromCharCode(x);
        w.__uploads.push({ names, metadata: typeof meta === 'string' ? meta : await (meta as Blob).text(), image: btoa(bin) });
      }
      return original(input, init);
    };
  });
}

/** JPEG width/height from the SOF marker. */
function jpegSize(b: Buffer): [number, number] {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad JPEG marker');
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

test('CAM-01 frames are valid 1280×720 JPEGs with the right camera id, and carry no ground truth', async ({ page }) => {
  await recordUploads(page);
  await open(page, 'scenario=occlusion&env=dusk');
  // Turn the development ground-truth view on: it must change nothing that is uploaded.
  await page.getByTestId('truth-toggle').check();
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/v1/cameras/cam-01/frames'));
  await page.getByTestId('send-frame').click();
  expect((await reply).status()).toBe(202);
  const [upload] = await page.evaluate(() => (window as never as { __uploads: { names: string[]; metadata: string; image: string }[] }).__uploads);
  expect([...upload!.names].sort()).toEqual(['image', 'metadata']);
  const metadata = JSON.parse(upload!.metadata);
  expect(Object.keys(metadata).sort()).toEqual(FRAME_FIELDS);
  expect(metadata.camera_id).toBe('cam-01');
  const jpeg = Buffer.from(upload!.image, 'base64');
  expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  expect(jpegSize(jpeg)).toEqual([1280, 720]);
  expect(jpeg.toString('latin1')).not.toMatch(/occupied|truth|scenario|vehicle/i);
  await expect(page.getByTestId('truth-list')).toBeVisible();
});

test('scenario and lighting selectors switch deterministically', async ({ page }) => {
  await open(page, 'scenario=static&env=day');
  await page.getByTestId('scenario-select').selectOption('crossing');
  await expect(page).toHaveURL(/scenario=crossing/);
  const t0 = await page.evaluate(() => (window as never as { __garageLab: { lab: { world: { simTimeMs: number; scenario: { id: string } } } } }).__garageLab.lab.world.scenario.id);
  expect(t0).toBe('crossing');
  const brightness: Record<string, number> = {};
  for (const env of ['clear_day', 'dusk', 'night']) {
    await page.getByTestId('preset-select').selectOption(env);
    await page.waitForTimeout(400);
    brightness[env] = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=garage-cam-01-canvas]') as HTMLCanvasElement;
      const g = document.createElement('canvas').getContext('2d')!;
      g.canvas.width = 160;
      g.canvas.height = 90;
      g.drawImage(c, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
      return s / (d.length / 4) / 3;
    });
  }
  await expect(page).toHaveURL(/env=night/);
  expect(brightness.night).toBeLessThan(brightness.clear_day!);
  // Reset returns to t = 0 of the same scenario.
  await page.getByTestId('play').click();
  await page.waitForTimeout(800);
  await page.getByTestId('reset').click();
  const t = await page.evaluate(() => (window as never as { __garageLab: { lab: { world: { simTimeMs: number } } } }).__garageLab.lab.world.simTimeMs);
  expect(t).toBe(0);
});

test('calibration view shows twelve projected bays and never enables OPEN', async ({ page, request }) => {
  await open(page, 'scenario=static&env=day&calib=1');
  await expect(page.locator('.g-bay polygon')).toHaveCount(12);
  await expect(page.locator('.g-calib-note')).toContainText('12 bays projected from 3D corners');
  const reply = page.waitForResponse((r) => r.url().endsWith('/api/v1/cameras/cam-01/frames'));
  await page.getByTestId('send-frame').click();
  const body = await (await reply).json();
  expect(body.observations.some((o: { state: string }) => o.state === 'OPEN')).toBe(false);
  const health = await (await request.get(`${API}/api/v1/health`)).json();
  expect(health.inference.thresholds.allow_open).toBe(false);
  expect(health.calibration.version).toMatch(/^garage-cam-01-v\d+$/);
});
