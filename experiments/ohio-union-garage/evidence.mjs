// Visual evidence for the Ohio Union North Garage-inspired simulation (needs npm run demo:ohio running).
//   SIM_URL=… WEB_URL=… node evidence.mjs <out-dir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'evidence';
mkdirSync(out, { recursive: true });
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5201';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5202';
const CAMS = ['cam-01', 'cam-02', 'cam-03', 'cam-04', 'cam-05', 'cam-06', 'cam-07', 'cam-08'];
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } });
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });
const ready = (p) => p.waitForFunction(() => window.__showcase?.streamer.ready, null, { timeout: 120000 });
const open = async (p, q) => {
  await p.goto(`${SIM}/?sim=ohio-union&${q}`);
  await p.waitForSelector('body[data-lab-ready="1"]');
  await ready(p);
};

// Live garage, engineering view, after two full camera cycles: observer quick views, each CCTV camera, the grid.
const sim = await ctx.newPage();
await open(sim, 'scenario=live&env=day&view=observer');
await sim.waitForTimeout(45000);
for (const v of ['Overview', 'Entrance', 'Drive aisle', 'Spine', 'Ramp', 'West module', 'CCTV overview']) {
  await sim.getByTestId(`quick-${v}`).click();
  await sim.waitForTimeout(1600);
  await shot(sim, `observer-${v.toLowerCase().replace(/ /g, '-')}`);
}
for (const cam of CAMS) {
  await sim.getByTestId(`view-${cam}`).click();
  await sim.waitForTimeout(1500);
  await sim.locator(`[data-testid=cctv-${cam}]`).screenshot({ path: `${out}/${cam}-live.png` });
}
await sim.getByTestId('view-cctv-grid').click();
await sim.waitForTimeout(2500);
await shot(sim, 'all-cctv-grid');

// Driver page reacting to the live site (and the recommendation's freshness refusal on this machine).
const driver = await ctx.newPage();
await driver.goto(`${WEB}/?record=1`);
await driver.waitForTimeout(15000);
await shot(driver, 'driver-live-state');
await driver.getByTestId('find-parking').click();
await driver.waitForTimeout(2500);
await driver.screenshot({ path: `${out}/driver-after-find-parking.png`, fullPage: true });
await driver.close();
await sim.close();

// Lighting: the same camera in day, dusk, night and overcast (A2 running).
for (const env of ['day', 'dusk', 'night', 'overcast']) {
  const p = await ctx.newPage();
  await open(p, `scenario=live&env=${env}&view=cam-05`);
  await p.waitForTimeout(24000);
  await p.locator('[data-testid=cctv-cam-05]').screenshot({ path: `${out}/lighting-${env}-cam-05.png` });
  await p.getByTestId('view-observer').click();
  await p.getByTestId('quick-Entrance').click();
  await p.waitForTimeout(1600);
  await shot(p, `lighting-${env}-entrance`);
  await p.close();
}

// Presentation mode with ramp traffic.
{
  const p = await ctx.newPage();
  await open(p, 'scenario=pass-through&env=dusk&present=1&view=observer');
  await p.waitForTimeout(20000);
  await p.getByTestId('quick-Ramp').click();
  await p.waitForTimeout(1600);
  await shot(p, 'presentation-ramp-traffic');
  await p.close();
}

// Calibration: the static validation scene, every camera with its owned polygons; map with truth.
{
  const p = await ctx.newPage();
  await open(p, 'scenario=validation&env=day&view=cctv-grid');
  await p.waitForTimeout(45000);
  await shot(p, 'calibration-validation-all-cameras');
  for (const cam of CAMS) {
    await p.getByTestId(`view-${cam}`).click();
    await p.waitForTimeout(1200);
    await p.locator(`[data-testid=cctv-${cam}]`).screenshot({ path: `${out}/calibration-${cam}.png` });
  }
  await p.getByTestId('truth-toggle').check();
  await p.waitForTimeout(500);
  await p.locator('[data-testid=garage-map]').screenshot({ path: `${out}/static-validation-map-with-truth.png` });
  await p.close();
}
await b.close();
console.log(`evidence → ${out}`);
