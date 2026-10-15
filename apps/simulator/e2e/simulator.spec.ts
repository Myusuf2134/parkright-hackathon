/**
 * The simulator against a real API, over real HTTP. Every assertion about leakage is
 * made on the request bytes the browser actually sent.
 */
import { expect, type Page, type Request, test } from '@playwright/test';
import { API_PORT } from '../playwright.config.ts';
import { jpegMarkers, parseMultipart } from './multipart.ts';

const API = `http://127.0.0.1:${API_PORT}`;
const SPACES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

interface Wire {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

/** Records every frame request exactly as the browser emits it (before the dev proxy). */
async function recordFrames(page: Page): Promise<Wire[]> {
  const wire: Wire[] = [];
  await page.route('**/api/v1/cameras/*/frames', async (route) => {
    const r = route.request();
    wire.push({ url: r.url(), headers: r.headers(), body: r.postDataBuffer()! });
    await route.continue();
  });
  return wire;
}

async function openLab(page: Page, hash = 'seed=4242&env=clear_day&occ=') {
  await page.goto(`/#${hash}`);
  await page.waitForSelector('body[data-lab-ready="1"]');
  await expect(page.getByTestId('api-status')).toHaveText(/API CONNECTED/);
}

/** Clicks "Capture & send" and returns the frame request plus its ground-truth request. */
async function sendFrame(page: Page, wire: Wire[]): Promise<{ frame: Wire; frameStatus: number; truth: Request }> {
  const frameResponse = page.waitForResponse((r) => r.url().includes('/frames') && r.request().method() === 'POST');
  const truthResponse = page.waitForResponse((r) => r.url().includes('/evaluation/ground-truth') && r.request().method() === 'POST');
  await page.getByTestId('send-frame').click();
  const fr = await frameResponse;
  const tr = await truthResponse;
  expect(tr.status()).toBe(202);
  return { frame: wire.at(-1)!, frameStatus: fr.status(), truth: tr.request() };
}

function inspectFrame(w: Wire) {
  const parts = parseMultipart(w.body, w.headers['content-type']!);
  const metadataPart = parts.find((p) => p.name === 'metadata')!;
  const imagePart = parts.find((p) => p.name === 'image')!;
  return { parts, metadataText: metadataPart.body.toString('utf8'), metadata: JSON.parse(metadataPart.body.toString('utf8')), imagePart, jpeg: imagePart.body };
}

test('empty deck → frame, park A1 → frame: pixels change, truth goes separately, nothing leaks, backend stays UNCERTAIN', async ({ page }) => {
  const wire = await recordFrames(page);
  await openLab(page);
  await page.getByTestId('clear-all').click();
  for (const id of SPACES) await expect(page.getByTestId(`truth-${id}`)).toHaveText('empty');

  // 1–4: all 12 empty, render frame N, upload succeeds, ground truth sent separately.
  const n = await sendFrame(page, wire);
  expect(n.frameStatus).toBe(202);

  // 5–6: park a vehicle in A1, render frame N+1.
  await page.getByTestId('bay-A1').click();
  await page.getByTestId('park').click();
  await expect(page.getByTestId('truth-A1')).toHaveText('occupied');
  const n1 = await sendFrame(page, wire);
  expect(n1.frameStatus).toBe(202); // 10: backend accepts

  const a = inspectFrame(n.frame);
  const b = inspectFrame(n1.frame);
  for (const f of [a, b]) {
    // 9: exactly two parts; metadata is exactly the canonical five fields.
    expect(f.parts.map((p) => p.name)).toEqual(['metadata', 'image']);
    expect(Object.keys(f.metadata)).toEqual(['session_id', 'camera_id', 'seq', 'sim_time_ms', 'captured_at']);
    expect(f.metadataText).not.toMatch(/occupied|empty|truth|vehicle|A1|B\d/i);
    expect(f.imagePart.filename).toBe('frame.jpg');
    expect(f.imagePart.contentType).toBe('image/jpeg');
    // A real JPEG with no comment (FFFE) or EXIF/APP1 (FFE1) segments that could carry data.
    expect([...f.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    const markers = jpegMarkers(f.jpeg);
    expect(markers).toContain(0xda);
    expect(markers).not.toContain(0xfe);
    expect(markers).not.toContain(0xe1);
    expect(f.jpeg.length).toBeGreaterThan(20_000);
  }
  // No truth in the URL or in custom headers.
  for (const w of [n.frame, n1.frame]) {
    expect(new URL(w.url).pathname).toBe('/api/v1/cameras/cam-01/frames');
    expect(new URL(w.url).search).toBe('');
    expect(Object.keys(w.headers).filter((h) => h.startsWith('x-'))).toEqual([]);
    expect(JSON.stringify(w.headers)).not.toMatch(/occupied|truth|A1/i);
    expect(w.headers.authorization).toBeUndefined(); // the token is added server-side by the proxy
  }
  // Same session, consecutive seq, non-decreasing sim time.
  expect(b.metadata.session_id).toBe(a.metadata.session_id);
  expect(b.metadata.seq).toBe(a.metadata.seq + 1);
  expect(b.metadata.sim_time_ms).toBeGreaterThanOrEqual(a.metadata.sim_time_ms);

  // 7: the pixels differ because a car is now in A1.
  expect(Buffer.compare(a.jpeg, b.jpeg)).not.toBe(0);

  // 4 & 8: ground truth went separately, for the same frames, and says A1 is occupied.
  const truthN = n.truth.postDataJSON();
  const truthN1 = n1.truth.postDataJSON();
  expect(new URL(n1.truth.url()).pathname).toBe('/api/v1/evaluation/ground-truth');
  expect([truthN.seq, truthN.session_id]).toEqual([a.metadata.seq, a.metadata.session_id]);
  expect([truthN1.seq, truthN1.session_id]).toEqual([b.metadata.seq, b.metadata.session_id]);
  expect(truthN.spaces.every((s: { truth: string }) => s.truth === 'empty')).toBe(true);
  expect(truthN1.spaces.filter((s: { truth: string }) => s.truth === 'occupied')).toEqual([{ space_id: 'A1', truth: 'occupied' }]);
  const stored = await (await fetch(`${API}/api/v1/evaluation/ground-truth?camera_id=cam-01&session_id=${b.metadata.session_id}`, { headers: { authorization: 'Bearer e2e-ingest-token-0123456789' } })).json();
  expect(stored.at(-1).spaces.find((s: { space_id: string }) => s.space_id === 'A1').truth).toBe('occupied');

  // 11: with the "none" provider the backend correctly stays UNCERTAIN everywhere.
  const occupancy = await (await fetch(`${API}/api/v1/facilities/garage-01/spaces`)).json();
  expect(occupancy.counts).toEqual({ total: 12, open: 0, occupied: 0, uncertain: 12 });
  expect(occupancy.spaces.find((s: { space_id: string }) => s.space_id === 'A1')).toMatchObject({ current_state: 'UNCERTAIN', frame_seq: b.metadata.seq, model: { provider: 'none', version: '0' } });

  // cam-01 renders only the world layer.
  expect(await page.evaluate(() => (window as any).__visionLab.lab.camera.camera.layers.mask)).toBe(1);
});

test('the same seed, layout, preset and camera pose reproduce identical pixels', async ({ page }) => {
  const hash = 'seed=777&env=dusk&occ=A2.3,A5.0,B1.7,B4.2';
  const capture = () =>
    page.evaluate(async () => {
      const f = await (window as any).__visionLab.lab.captureFrame();
      return Array.from(new Uint8Array(await f.jpeg.arrayBuffer()));
    });
  await openLab(page, hash);
  const first = await capture();
  const again = await capture();
  expect(again).toEqual(first);
  await page.reload();
  await page.waitForSelector('body[data-lab-ready="1"]');
  expect(await capture()).toEqual(first);
  await openLab(page, 'seed=778&env=dusk&occ=A2.3,A5.0,B1.7,B4.2');
  expect(await capture()).not.toEqual(first);
});

test('streams at 5 FPS with consecutive seq in one session', async ({ page }) => {
  const frames = await recordFrames(page);
  await openLab(page);
  await page.getByTestId('play').click();
  await page.getByTestId('rate-5').click();
  await page.waitForTimeout(2200);
  await page.getByTestId('rate-0').click();
  await page.waitForTimeout(400);
  const metas = frames.map((r) => inspectFrame(r).metadata);
  expect(metas.length).toBeGreaterThanOrEqual(8);
  expect(new Set(metas.map((m) => m.session_id)).size).toBe(1);
  metas.forEach((m, i) => i > 0 && expect(m.seq).toBe(metas[i - 1].seq + 1));
  metas.forEach((m, i) => i > 0 && expect(m.sim_time_ms).toBeGreaterThan(metas[i - 1].sim_time_ms));
  await expect(page.getByTestId('last-status')).toHaveText('accepted');
});

test('keeps running when the API is unreachable, and seq carries on afterwards', async ({ page }) => {
  await openLab(page);
  await page.getByTestId('send-frame').click();
  await expect(page.getByTestId('last-status')).toHaveText('accepted');
  const before = Number(await page.getByTestId('next-seq').textContent());

  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
  await page.getByTestId('play').click();
  await page.getByTestId('send-frame').click();
  await expect(page.getByTestId('last-status')).toHaveText('disconnected');
  await expect(page.getByTestId('api-status')).toHaveText(/API DISCONNECTED/);
  await page.getByTestId('send-frame').click();
  await expect(page.getByTestId('next-seq')).toHaveText(String(before + 2));
  // Still rendering and simulating.
  await page.getByTestId('bay-B6').click();
  await page.getByTestId('park').click();

  await page.unroute('**/api/v1/**');
  const response = page.waitForResponse((r) => r.url().includes('/frames'));
  await page.getByTestId('send-frame').click();
  const res = await response;
  expect(res.status()).toBe(202);
  const body = await res.json();
  expect(body.seq).toBe(before + 2);
  expect(body.gap).toBe(2); // the two frames that never arrived
  await expect(page.getByTestId('api-status')).toHaveText(/API CONNECTED/);
});
