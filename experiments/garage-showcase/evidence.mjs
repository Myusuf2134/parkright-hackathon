// Visual evidence for the 34-space showcase (needs the showcase stack running).
//   SIM_URL=… WEB_URL=… node evidence.mjs <out-dir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'evidence';
mkdirSync(out, { recursive: true });
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5201';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5202';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } });
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });
const ready = (p) => p.waitForFunction(() => window.__showcase?.streamer.ready, null, { timeout: 120000 });

// Live garage in engineering view: observer, then each CCTV camera, after a few full cycles.
const sim = await ctx.newPage();
await sim.goto(`${SIM}/?showcase=1&sim=garage&scenario=live&env=day&view=observer`);
await sim.waitForSelector('body[data-lab-ready="1"]');
await ready(sim);
await sim.waitForTimeout(40000);
await shot(sim, 'observer-34-spaces-engineering');
await sim.getByTestId('quick-CCTV overview').click();
await sim.waitForTimeout(1500);
await shot(sim, 'observer-cctv-overview');
await sim.getByTestId('quick-Overview').click();
for (const cam of ['cam-01', 'cam-02', 'cam-03', 'cam-04']) {
  await sim.getByTestId(`view-${cam}`).click();
  await sim.waitForTimeout(2500);
  await shot(sim, `${cam}-live`);
}
await sim.getByTestId('view-cctv-grid').click();
await sim.waitForTimeout(2500);
await shot(sim, 'all-cctv-grid');
await sim.locator('[data-testid=event-feed]').screenshot({ path: `${out}/event-feed.png` });

// Driver page reacting to the live garage, with the recommendation.
const driver = await ctx.newPage();
await driver.goto(`${WEB}/?record=1`);
await driver.waitForTimeout(15000);
await shot(driver, 'driver-live-state');
await driver.getByTestId('find-parking').click();
await driver.waitForTimeout(1500);
await driver.screenshot({ path: `${out}/driver-live-state-with-recommendation.png`, fullPage: true });
await driver.close();
await sim.close();

// Lighting: the same CCTV view in day, dusk and night (A2 still running).
for (const env of ['day', 'dusk', 'night']) {
  const p = await ctx.newPage();
  await p.goto(`${SIM}/?showcase=1&sim=garage&scenario=live&env=${env}&view=cam-02`);
  await p.waitForSelector('body[data-lab-ready="1"]');
  await ready(p);
  await p.waitForTimeout(16000);
  await shot(p, `lighting-${env}-cam-02`);
  await p.close();
}

// Presentation mode during traffic; class transition.
{
  const p = await ctx.newPage();
  await p.goto(`${SIM}/?showcase=1&sim=garage&scenario=class-transition&env=dusk&present=1&view=observer`);
  await p.waitForSelector('body[data-lab-ready="1"]');
  await ready(p);
  await p.waitForTimeout(25000);
  await shot(p, 'presentation-mode');
  await p.getByTestId('quick-Entrance').click();
  await p.waitForTimeout(1500);
  await shot(p, 'live-traffic-entrance');
  await p.close();
}

// Calibration: the static validation scene, every camera with its owned polygons, no traffic.
{
  const p = await ctx.newPage();
  await p.goto(`${SIM}/?showcase=1&sim=garage&scenario=validation&env=day&view=cctv-grid`);
  await p.waitForSelector('body[data-lab-ready="1"]');
  await ready(p);
  await p.waitForTimeout(20000);
  await shot(p, 'calibration-validation-all-cameras');
  for (const cam of ['cam-01', 'cam-02', 'cam-03', 'cam-04']) {
    await p.getByTestId(`view-${cam}`).click();
    await p.waitForTimeout(1500);
    await p.locator(`[data-testid=cctv-${cam}]`).screenshot({ path: `${out}/calibration-${cam}.png` });
  }
  await p.getByTestId('truth-toggle').check();
  await p.waitForTimeout(500);
  await p.locator('[data-testid=garage-map]').screenshot({ path: `${out}/static-validation-map-with-truth.png` });
  await p.close();
}
await b.close();
console.log(`evidence → ${out}`);
