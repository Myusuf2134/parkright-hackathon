// Ohio Union North Garage-inspired simulation: performance with the simulator (observer view + CCTV)
// and the driver page open, 60 s of live traffic (eight cameras, one A2).
//   SIM_URL=… WEB_URL=… node perf.mjs <out.json> [live-metrics.json]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem } from 'node:os';

const [out = 'performance.json', liveMetrics] = process.argv.slice(2);
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5201';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5202';
const SECONDS = 60;
const stat = (a) => { const s = a.filter((v) => v !== null && v !== undefined && Number.isFinite(v)).sort((x, y) => x - y); return s.length ? { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1), p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] } : null; };

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1680, height: 1000 } });
const driver = await ctx.newPage();
// The driver page's own WebSocket: record when each frame's update arrives there.
await driver.addInitScript(() => {
  window.__arrivals = [];
  const W = window.WebSocket;
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (e) => {
        try {
          const m = JSON.parse(String(e.data));
          if (m.type === 'occupancy_update' && m.frame) window.__arrivals.push({ key: `${m.frame.camera_id}/${m.frame.session_id}/${m.frame.seq}`, at: Date.now() });
        } catch {}
      });
    }
  };
});
const sim = await ctx.newPage();
await sim.goto(`${SIM}/?sim=ohio-union&scenario=live&env=day&view=observer`);
await sim.waitForSelector('body[data-lab-ready="1"]');
await sim.waitForFunction(() => window.__showcase.streamer.ready, null, { timeout: 120000 });
await driver.goto(`${WEB}/?record=1`);
const load0 = loadavg()[0];
const simRes = await sim.evaluate(async (seconds) => {
  const { lab, streamer } = window.__showcase;
  const caps = [];
  const cap = lab.capture.bind(lab);
  lab.capture = async (id) => { const f = await cap(id); caps.push({ id, at: f.capturedAt.getTime(), encodeMs: f.encodeMs }); return f; };
  // Key each capture by (camera, session, seq) as the streamer assigns them.
  const keyed = [];
  const send = streamer.sendOne.bind(streamer);
  streamer.sendOne = async (id) => {
    const st = streamer.streams.get(id);
    keyed.push({ key: `${id}/${st.sessionId}/${st.nextSeq}`, at: Date.now() });
    return send(id);
  };
  const renders = [];
  const render = lab.render.bind(lab);
  lab.render = (id) => { const t = performance.now(); render(id); renders.push({ id, ms: performance.now() - t, at: t }); };
  // Observer FPS: animation frames actually delivered while the observer view is shown.
  let frames = 0;
  const count = () => { frames++; if (running) requestAnimationFrame(count); };
  let running = true;
  requestAnimationFrame(count);
  const t0 = performance.now();
  const before = [...streamer.streams.values()].map((s) => s.accepted).reduce((a, b) => a + b, 0);
  await new Promise((r) => setTimeout(r, seconds * 1000 / 2));
  const observerFps = frames / ((performance.now() - t0) / 1000);
  // Second half: a CCTV view is shown (15 fps preview requested).
  running = false;
  document.querySelector('[data-testid=view-cam-02]').click();
  const r0 = renders.length;
  const t1 = performance.now();
  await new Promise((r) => setTimeout(r, seconds * 1000 / 2));
  const cctvRenders = renders.slice(r0).filter((x) => x.id === 'cam-02').length / ((performance.now() - t1) / 1000);
  const accepted = [...streamer.streams.values()].map((s) => s.accepted).reduce((a, b) => a + b, 0) - before;
  const sessions = Object.fromEntries([...streamer.streams.values()].map((s) => [s.id, s.sessionId]));
  return { observerFps, cctvPreviewFps: cctvRenders, renderMs: renders.map((r) => r.ms), accepted, caps, keyed, sessions, seconds, simFps: lab.fps,
    drawCalls: (() => { const r = lab.cctv.renderer; lab.render('cam-05'); return r.info.render.calls; })(),
    a2ByCamera: Object.fromEntries([...streamer.streams.values()].map((s) => [s.id, s.last?.a2Ms ?? null])) };
}, SECONDS);
const arrivals = await driver.evaluate(() => window.__arrivals);
const loads = [load0, loadavg()[0]];
await b.close();

// Camera → driver: capture (sim page) to the update arriving on the driver page's WebSocket, matched by (camera, session, seq).
const byKey = new Map(arrivals.map((a) => [a.key, a.at]));
const driverLatency = simRes.keyed.filter((k) => byKey.has(k.key)).map((k) => byKey.get(k.key) - k.at);
const live = liveMetrics ? JSON.parse(readFileSync(liveMetrics, 'utf8')) : null;
const report = {
  schema: 'parkright-ohio-union-perf-v1', created_at: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, cores: cpus().length, memory_gb: Math.round(totalmem() / 2 ** 30) },
  note: 'Measured on this machine (Apple M2, 8 GB), not an M5. Load average is recorded because macOS background work changes A2 latency a lot.',
  load_average: loads.map((l) => +l.toFixed(1)),
  observer_fps: Math.min(30, +simRes.observerFps.toFixed(1)),
  observer_raf_fps: +simRes.observerFps.toFixed(1),
  simulation_loop_fps: simRes.simFps,
  cctv_draw_calls_per_frame: simRes.drawCalls,
  cctv_preview_fps: +simRes.cctvPreviewFps.toFixed(1),
  cctv_render_ms: stat(simRes.renderMs),
  jpeg_encode_ms: stat(simRes.caps.map((c) => c.encodeMs)),
  camera_schedule: 'round robin CAM-01 → … → CAM-08, one frame in flight, no extra wait (interval = A2 time)',
  accepted_frames_per_second: +(simRes.accepted / simRes.seconds).toFixed(2),
  camera_to_driver_update_ms: stat(driverLatency),
  from_live_measurement: live && {
    frames: live.overall.frames,
    a2_inference_ms: live.overall.a2_ms,
    a2_inference_ms_by_camera: Object.fromEntries(Object.entries(live.by_camera).map(([k, v]) => [k, v.a2_ms])),
    ingest_ms: live.overall.ingest_ms,
    camera_to_websocket_ms: live.overall.ws_latency_ms,
    facility_refresh_cycle_ms: live.facility_refresh.cycle_ms,
  },
  compared_with_m2_34_space_showcase: { a2_mean_ms: 2180, accepted_fps: '0.38–0.48', facility_refresh_mean_ms: 9100, observer_fps: 30, preview_fps: 15.4, note: 'experiments/garage-showcase/evidence/performance.json, same machine, other runs' },
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
