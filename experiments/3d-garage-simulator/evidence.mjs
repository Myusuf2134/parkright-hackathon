// Visual evidence for the 3D garage simulator. Needs the garage stack running (A2 for the detection shot).
//   SIM_URL=http://127.0.0.1:5191 node evidence.mjs <out-dir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'evidence';
mkdirSync(out, { recursive: true });
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5191';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function page(query) {
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.goto(`${SIM}/?sim=garage&${query}`);
  await p.waitForSelector('body[data-lab-ready="1"]');
  await p.waitForTimeout(1800);
  return p;
}
const cam = (p, name) => p.locator('[data-testid=garage-feed]').screenshot({ path: `${out}/${name}.png` });

// CAM-01 views: day / dusk / night, and two motion scenarios mid-route.
for (const [name, q] of [
  ['cam-01-day', 'scenario=full-garage&env=day&record=1'],
  ['cam-01-dusk', 'scenario=static&env=dusk&record=1'],
  ['cam-01-night', 'scenario=static&env=night&record=1'],
  ['scenario-entering-parking', 'scenario=entering&env=day&t=13000&record=1'],
  ['scenario-crossing', 'scenario=crossing&env=day&t=8500&record=1'],
  ['scenario-occlusion', 'scenario=occlusion&env=dusk&t=14500&record=1'],
]) {
  const p = await page(q);
  await cam(p, name);
  await p.close();
}

// Full UI with the observer view, and the calibration overlay.
{
  const p = await page('scenario=static&env=day');
  await p.screenshot({ path: `${out}/ui-with-observer-view.png` });
  await p.locator('[data-testid=observer-view]').screenshot({ path: `${out}/observer-view.png` });
  await p.getByTestId('calib-toggle').check();
  await p.waitForTimeout(300);
  await cam(p, 'calibration-overlay');
  await p.close();
}

// A2 detections on a real frame (static scene and full garage).
for (const [name, q] of [['a2-detections-static-day', 'scenario=static&env=day&calib=1'], ['a2-detections-full-night', 'scenario=full-garage&env=night']]) {
  const p = await page(q);
  await p.waitForFunction(() => window.__garageLab.streamer.health?.inference?.inference_ready, null, { timeout: 120000 });
  const reply = p.waitForResponse((r) => r.url().endsWith('/api/v1/cameras/cam-01/frames'));
  await p.getByTestId('send-frame').click();
  await reply;
  await p.waitForTimeout(800);
  await cam(p, name);
  await p.close();
}
await b.close();
console.log(`evidence written to ${out}`);
