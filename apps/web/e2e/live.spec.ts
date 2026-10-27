/**
 * Driver app against the real API (apps/web/e2e/live_api.py: real ingestion, staleness,
 * WebSocket and recommendations, with a scripted provider instead of A2).
 */
import { expect, test } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.PARKRIGHT_LIVE_PORT ?? 8433}`;
const post = (path: string, body: unknown) => fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const V4 = { A1: 'OCCUPIED', A2: 'OPEN', A3: 'OCCUPIED', A4: 'OPEN', A5: 'UNCERTAIN', A6: 'OPEN', B1: 'OPEN', B2: 'OCCUPIED', B3: 'UNCERTAIN', B4: 'OPEN', B5: 'OPEN', B6: 'OPEN' };

test.beforeEach(async () => {
  await post('/__test/camera', { paused: false });
  await post('/__test/states', V4);
});

test('live counts follow the camera through the real API', async ({ page }) => {
  await page.goto('/app/?device=iphone15&splash=off');
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
  await post('/__test/states', { A2: 'OCCUPIED', A4: 'OCCUPIED' });
  await expect(page.getByTestId('open-count')).toHaveText('5', { timeout: 10_000 });
});

test('a real trip is rechecked, watched and warned', async ({ page }) => {
  await page.goto('/app/?device=iphone15&splash=off');
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
  await page.getByTestId('go').click();
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'ok');
  await post('/__test/states', { A2: 'OCCUPIED' });
  await expect(page.getByTestId('trip')).toHaveAttribute('data-watch', 'taken', { timeout: 10_000 });
});

test('when the camera stops, spaces go stale and nothing is offered', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/app/?device=iphone15&splash=off');
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
  await post('/__test/camera', { paused: true });
  await expect(page.getByTestId('open-count')).toHaveText('0', { timeout: 25_000 });
  await expect(page.getByTestId('prov-quiet')).toBeVisible();
  await post('/__test/camera', { paused: false });
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
});

test('advice comes from the API and says where it came from', async ({ page }) => {
  await page.goto('/app/?device=iphone15&splash=off');
  await expect(page.getByTestId('open-count')).toHaveText('7', { timeout: 10_000 });
  await page.getByTestId('view-spaces').click();
  await expect(page.getByTestId('advice')).toContainText('Local fallback', { timeout: 10_000 });
});
