// Showcase measurement through the real API (A2 + four calibrations), scored against simulator
// ground truth captured at the same instant as each frame (ground truth is used only here).
//
//   node measure.mjs validation <out-dir> [--presets clear_day,dusk,night] [--cycles 2]
//       the static recording scene: per camera, perception occupied == truth occupied?
//   node measure.mjs live <out-dir> [--presets ...] [--scenarios live,class-transition] [--seconds 90]
//       traffic running: per-frame occupied precision/recall, latency, refresh rate, camera→WebSocket
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const [mode, out = 'results', ...rest] = process.argv.slice(2);
const opt = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const PRESETS = opt('--presets', 'clear_day,dusk,night').split(',');
const SCENARIOS = mode === 'validation' ? ['validation'] : opt('--scenarios', 'live,class-transition,occlusion-stress').split(',');
const CYCLES = Number(opt('--cycles', 2));
const SECONDS = Number(opt('--seconds', 90));
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5201';
const API = process.env.API_URL ?? 'http://127.0.0.1:8441';
mkdirSync(out, { recursive: true });

// Camera → WebSocket latency: every occupancy_update carries its frame (camera, session, seq).
const wsSeen = new Map();
const ws = new WebSocket(`${API.replace('http', 'ws')}/api/v1/realtime?facility_id=garage-01`);
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === 'occupancy_update' && m.frame) wsSeen.set(`${m.frame.camera_id}/${m.frame.session_id}/${m.frame.seq}`, Date.now());
};

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const frames = [];
const runs = [];
for (const preset of PRESETS) {
  for (const scenario of SCENARIOS) {
    const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
    await p.goto(`${SIM}/?showcase=1&sim=garage&scenario=${scenario}&env=${preset}&stream=0&view=${process.env.MEASURE_VIEW ?? "cam-02"}`);
    await p.waitForSelector('body[data-lab-ready="1"]');
    await p.waitForFunction(() => window.__showcase.streamer.ready && window.__showcase.streamer.health?.calibration?.cameras, null, { timeout: 120000 });
    const load0 = loadavg()[0];
    const res = await p.evaluate(async ({ mode, cycles, seconds }) => {
      const { lab, streamer } = window.__showcase;
      const truths = [];
      const cap = lab.capture.bind(lab);
      lab.capture = async (id) => {
        const f = await cap(id);
        truths.push({ id, occupied: f.truth.spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id), encodeMs: f.encodeMs, bytes: f.jpeg.size, capturedAt: f.capturedAt.toISOString(), moving: f.truth.vehicles.filter((v) => v.moving).length });
        return f;
      };
      if (mode === 'validation') lab.world.pause();
      const ids = ['cam-01', 'cam-02', 'cam-03', 'cam-04'];
      const rows = [];
      const t0 = performance.now();
      let cycle = 0;
      while (mode === 'validation' ? cycle < cycles : performance.now() - t0 < seconds * 1000) {
        const cs = performance.now();
        for (const id of ids) {
          const st = streamer.streams.get(id);
          const last = await streamer.sendOne(id);
          const tr = truths.at(-1);
          rows.push({
            cycle, camera: id, seq: last?.seq ?? null, session: st.sessionId, status: last?.status ?? 'none', truth: tr.occupied, predicted: last?.occupied ?? [],
            open: (last?.observations ?? []).filter((o) => o.state === 'OPEN').map((o) => o.space_id),
            vehicles: (last?.detections ?? []).filter((d) => d.confidence >= 0.65).length, a2_ms: last?.a2Ms ?? null, ingest_ms: last?.ingestMs ?? null,
            encode_ms: Math.round(tr.encodeMs), bytes: tr.bytes, captured_at: tr.capturedAt, moving: tr.moving, sim_ms: Math.round(lab.world.simTimeMs),
          });
        }
        rows.push({ cycleMs: Math.round(performance.now() - cs), cycle });
        cycle++;
      }
      return { rows, fps: lab.fps };
    }, { mode, cycles: CYCLES, seconds: SECONDS });
    for (const r of res.rows) {
      if (r.cycleMs !== undefined) { runs.push({ preset, scenario, cycle: r.cycle, cycle_ms: r.cycleMs }); continue; }
      const key = `${r.camera}/${r.session}/${r.seq}`;
      const seen = wsSeen.get(key);
      frames.push({ preset, scenario, ...r, ws_latency_ms: seen ? seen - Date.parse(r.captured_at) : null });
    }
    const ok = res.rows.filter((r) => r.status === 'accepted');
    console.log(`${preset.padEnd(9)} ${scenario.padEnd(17)} ${ok.length}/${res.rows.filter((r) => r.camera).length} frames · load ${load0.toFixed(1)}→${loadavg()[0].toFixed(1)} · sim fps ${res.fps}`);
    await p.close();
  }
}
await b.close();
ws.close();

const BAYS = { 'cam-01': 'A1 A2 A3 A4 A5 A6 A7 A8 A9', 'cam-02': 'B1 B2 B3 B4 B5 B6 B7 B8', 'cam-03': 'C1 C2 C3 C4 C5 C6 C7 C8', 'cam-04': 'D1 D2 D3 D4 D5 D6 D7 D8 D9' };
const stat = (a) => { const s = a.filter((v) => v !== null && v !== undefined).sort((x, y) => x - y); return s.length ? { n: s.length, mean: Math.round(s.reduce((x, y) => x + y, 0) / s.length), p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] } : null; };
function score(rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0, open = 0, n = 0;
  const fpBays = {}, fnBays = {};
  for (const r of rows) {
    if (r.status !== 'accepted') continue;
    n++;
    const T = new Set(r.truth), P = new Set(r.predicted);
    open += r.open.length;
    for (const id of BAYS[r.camera].split(' ')) {
      const t = T.has(id), q = P.has(id);
      if (t && q) tp++; else if (!t && q) { fp++; fpBays[id] = (fpBays[id] ?? 0) + 1; } else if (t && !q) { fn++; fnBays[id] = (fnBays[id] ?? 0) + 1; } else tn++;
    }
  }
  return {
    frames: n, tp, fp, fn, tn, open_reported: open,
    occupied_precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, occupied_recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
    false_occupied_rate: fp + tn ? +(fp / (fp + tn)).toFixed(3) : null, false_occupied_by_bay: fpBays, missed_by_bay: fnBays,
    a2_ms: stat(rows.map((r) => r.a2_ms)), ingest_ms: stat(rows.map((r) => r.ingest_ms)), encode_ms: stat(rows.map((r) => r.encode_ms)), ws_latency_ms: stat(rows.map((r) => r.ws_latency_ms)),
  };
}
const summary = {
  schema: `parkright-showcase-${mode}-v1`, created_at: new Date().toISOString(), mode,
  mapper: 'production A2 mapper, unchanged: occupied conf 0.65, coverage 0.45, allow_open false; each camera evaluates only its owned bays',
  overall: score(frames),
  by_preset: Object.fromEntries(PRESETS.map((p) => [p, score(frames.filter((f) => f.preset === p))])),
  by_scenario: Object.fromEntries(SCENARIOS.map((s) => [s, Object.fromEntries(PRESETS.map((p) => [p, score(frames.filter((f) => f.preset === p && f.scenario === s))]))])),
  by_camera: Object.fromEntries(Object.keys(BAYS).map((c) => [c, score(frames.filter((f) => f.camera === c))])),
  facility_refresh: { cycle_ms: stat(runs.map((r) => r.cycle_ms)) },
};
if (mode === 'validation') {
  summary.validation = frames.map((f) => ({ preset: f.preset, camera: f.camera, cycle: f.cycle, truth: f.truth, perception: f.predicted, equal: JSON.stringify(f.truth) === JSON.stringify(f.predicted) }));
  summary.all_equal = summary.validation.every((v) => v.equal);
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(summary, null, 2));
writeFileSync(`${out}/frames.json`, JSON.stringify(frames));
const csv = ['preset,scenario,camera,cycle,seq,status,truth,predicted,vehicles,a2_ms,ingest_ms,encode_ms,ws_latency_ms,moving'];
for (const f of frames) csv.push([f.preset, f.scenario, f.camera, f.cycle, f.seq, f.status, f.truth.join(' '), f.predicted.join(' '), f.vehicles, f.a2_ms, f.ingest_ms, f.encode_ms, f.ws_latency_ms, f.moving].join(','));
writeFileSync(`${out}/frames.csv`, csv.join('\n') + '\n');
console.log(JSON.stringify({ overall: { ...summary.overall, false_occupied_by_bay: undefined, missed_by_bay: undefined }, refresh: summary.facility_refresh, all_equal: summary.all_equal }, null, 1));
