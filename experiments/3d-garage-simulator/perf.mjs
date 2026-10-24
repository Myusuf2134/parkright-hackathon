// Performance of the garage path while CAM-01 streams at 1 fps for 40 s:
// preview FPS, accepted capture rate, JPEG encode, ingest (capture → 202), A2, and
// camera-to-state latency (frame capture → occupancy_update received on the WebSocket).
//   SIM_URL=http://127.0.0.1:5191 API_URL=http://127.0.0.1:8431 node perf.mjs <out.json>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const out = process.argv[2] ?? 'perf.json';
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5191';
const API = process.env.API_URL ?? 'http://127.0.0.1:8431';
const SECONDS = 40;

const ws = new WebSocket(`${API.replace('http', 'ws')}/api/v1/realtime?facility_id=garage-01`);
const updates = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === 'occupancy_update' && m.frame) updates.push({ seq: m.frame.seq, session: m.frame.session_id, at: Date.now() });
};
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(`${SIM}/?sim=garage&scenario=static&env=day&record=1`);
await p.waitForSelector('body[data-lab-ready="1"]');
await p.waitForFunction(() => window.__garageLab.streamer.health?.inference?.inference_ready, null, { timeout: 120000 });
const load0 = loadavg()[0];
const res = await p.evaluate(async (seconds) => {
  const { lab, streamer } = window.__garageLab;
  streamer.sendGroundTruth = false;
  const enc = [];
  const orig = lab.captureFrame.bind(lab);
  lab.captureFrame = async () => { const f = await orig(); enc.push(f.encodeMs); return f; };
  const fps = [];
  const t = setInterval(() => fps.push(lab.fps), 1000);
  streamer.setRate(1);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  streamer.setRate(0);
  while (streamer.inFlight) await new Promise((r) => setTimeout(r, 50));
  clearInterval(t);
  return { fps, enc, log: streamer.log.map((e) => ({ seq: e.seq, session: e.sessionId, capturedAt: e.capturedAt, status: e.status, latencyMs: e.latencyMs })), skipped: streamer.skippedTicks,
    a2: streamer.dataset.records.map((r) => r.diagnostics?.timings?.total_ms).filter(Boolean) };
}, SECONDS);
await new Promise((r) => setTimeout(r, 500));
await b.close();
ws.close();

const accepted = res.log.filter((e) => e.status === 'accepted');
const e2e = accepted.map((e) => { const u = updates.find((x) => x.seq === e.seq && x.session === e.session); return u ? u.at - Date.parse(e.capturedAt) : null; }).filter((v) => v !== null);
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? { n: s.length, mean: Math.round(s.reduce((x, y) => x + y, 0) / s.length), p50: Math.round(s[Math.floor(s.length / 2)]), p95: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]) } : null; };
const report = {
  schema: 'parkright-garage-perf-v1', created_at: new Date().toISOString(), seconds: SECONDS, attempted_fps: 1, load_average_start: +load0.toFixed(1), load_average_end: +loadavg()[0].toFixed(1),
  simulator_preview_fps: stat(res.fps.filter((f) => f > 0)),
  frames_attempted: res.log.length + res.skipped, frames_accepted: accepted.length, ticks_skipped_while_busy: res.skipped,
  accepted_capture_rate_fps: +(accepted.length / SECONDS).toFixed(2),
  jpeg_encode_ms: stat(res.enc), ingest_ms_capture_to_202: stat(accepted.map((e) => e.latencyMs)), a2_inference_ms: stat(res.a2),
  camera_to_state_ms_capture_to_websocket: stat(e2e),
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
