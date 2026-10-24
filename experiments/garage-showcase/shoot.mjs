// Showcase screenshots. node shoot.mjs <out-prefix> <query> [waitMs] [views...]
import { chromium } from 'playwright';
const [out, query, wait = '6000', ...views] = process.argv.slice(2);
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5201';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${SIM}/?showcase=1&sim=garage&${query}`);
await p.waitForSelector('body[data-lab-ready="1"]', { timeout: 60000 });
await p.waitForTimeout(Number(wait));
await p.screenshot({ path: `${out}.png` });
for (const v of views) {
  await p.getByTestId(`view-${v}`).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}-${v}.png` });
}
console.log(out, errors.length ? errors.slice(0, 4) : 'no errors');
await b.close();
