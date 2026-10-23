/**
 * npm run demo:reset with both windows open: the simulator reloads into the same scene and a
 * new stream session, the driver screen clears its result, and fresh A2 evidence resumes.
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const API = 'http://127.0.0.1:8400';
const fixture = JSON.parse(readFileSync(resolve(root, 'packages/shared/fixtures/hackathon-demo.json'), 'utf8'));

test('demo:reset returns both windows to the starting state', async ({ browser, request }) => {
  await request.post(`${API}/api/v1/demo/reset`);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const sim = await ctx.newPage();
  const driver = await ctx.newPage();
  await sim.goto(`http://127.0.0.1:5181/?demo=1#${fixture.simulator.hash}`);
  await driver.goto('http://127.0.0.1:5180/?record=1');
  await expect(driver.getByTestId('find-parking')).toBeEnabled({ timeout: 60_000 });
  await driver.getByTestId('find-parking').click();
  await expect(driver.getByTestId('result-space')).toHaveText(`${fixture.expected.level} · Space ${fixture.expected.space_id}`);
  const sessionBefore = await sim.getByTestId('session-id').textContent();

  const reloaded = sim.waitForEvent('load', { timeout: 15_000 });
  const out = execFileSync('node', ['scripts/demo/reset.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  expect(out).toContain('API reset');
  expect(out).toContain('fresh frames are flowing');
  await reloaded;

  // Same scene, new session; the driver result is gone until asked again.
  expect(decodeURIComponent(sim.url())).toContain(fixture.simulator.hash); // the simulator canonicalises (and appends the camera pose)
  await expect(sim.getByTestId('session-id')).not.toHaveText(sessionBefore ?? '');
  await expect(driver.getByTestId('result')).toHaveCount(0);
  const status = await (await request.get(`${API}/api/v1/demo/status`)).json();
  expect(status.camera.occupied).toEqual([...fixture.expected.camera_occupied_bays].sort());
  expect(status.camera.open).toEqual([]);
  await ctx.close();
});
