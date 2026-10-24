// Saves CAM-01 JPEGs exactly as they would be uploaded. node capture-jpeg.mjs <out.jpg> <query> [t]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const [out, query, t = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto(`${process.env.SIM_URL ?? 'http://127.0.0.1:5191'}/?${query}`);
await p.waitForSelector('body[data-lab-ready="1"]');
await p.waitForTimeout(1500);
const b64 = await p.evaluate(async (t) => {
  const { lab } = window.__garageLab;
  lab.world.setTime(t);
  const f = await lab.captureFrame();
  const bytes = new Uint8Array(await f.jpeg.arrayBuffer());
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}, Number(t));
writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(out, Buffer.from(b64, 'base64').length, 'bytes');
await b.close();
