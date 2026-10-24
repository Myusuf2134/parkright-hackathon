// Screenshots of the garage simulator. node shoot.mjs <out.png> <query> [waitMs] [--cam]
import { chromium } from 'playwright';
const [out, query, wait = '2500'] = process.argv.slice(2);
const camOnly = process.argv.includes('--cam');
const base = process.env.SIM_URL ?? 'http://127.0.0.1:5191';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/?${query}`);
await p.waitForSelector('body[data-lab-ready="1"]', { timeout: 30000 });
await p.waitForTimeout(Number(wait));
if (camOnly) await p.locator('[data-testid=garage-feed]').screenshot({ path: out });
else await p.screenshot({ path: out });
console.log(out, errors.length ? errors.slice(0, 3) : 'no errors');
await b.close();
