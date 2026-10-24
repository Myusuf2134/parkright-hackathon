// Sends one CAM-01 frame for a scenario/preset and screenshots the detections. node one-frame.mjs <out.png> <query> [t]
import { chromium } from 'playwright';
const [out, query, t = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`http://127.0.0.1:5191/?${query}`);
await p.waitForSelector('body[data-lab-ready="1"]');
await p.waitForFunction(() => window.__garageLab.streamer.health?.inference?.inference_ready, null, { timeout: 60000 });
const r = await p.evaluate(async (t) => {
  const { lab, streamer } = window.__garageLab;
  streamer.sendGroundTruth = false;
  lab.world.setTime(t);
  const e = await streamer.captureAndSend();
  const rec = streamer.dataset.records.at(-1);
  return { status: e?.status, latency: e?.latencyMs, occupied: rec?.predictions.filter((o) => o.state === 'OCCUPIED').map((o) => o.space_id),
    truth: rec?.ground_truth.spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id),
    dets: rec?.diagnostics?.detections?.map((d) => `${d.label}:${d.confidence.toFixed(2)}`), a2ms: rec?.diagnostics?.timings?.total_ms };
}, Number(t));
await p.waitForTimeout(400);
await p.locator('[data-testid=garage-feed]').screenshot({ path: out });
console.log(JSON.stringify(r));
await b.close();
