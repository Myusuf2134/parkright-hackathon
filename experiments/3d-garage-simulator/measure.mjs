// A2 baseline on the 3D garage: every scenario × day/dusk/night, frames at fixed sim times,
// through the real API (A2 + garage calibration). Ground truth comes from the simulator
// and is used only here, to score; it is never sent with a frame.
//
//   SIM_URL=http://127.0.0.1:5191 node measure.mjs <out-dir> [--step 1500] [--presets clear_day,dusk,night]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const args = process.argv.slice(2);
const out = args[0] ?? 'results';
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const STEP = Number(opt('--step', 1500));
const PRESETS = opt('--presets', 'clear_day,dusk,night').split(',');
const SCENARIOS = opt('--scenarios', 'static,entering,exiting,pass-by,crossing,neighbor-approach,fast-approach,occlusion,full-garage,sparse-garage').split(',');
const SIM = process.env.SIM_URL ?? 'http://127.0.0.1:5191';
mkdirSync(out, { recursive: true });

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const frames = [];
const started = Date.now();
for (const preset of PRESETS) {
  for (const scenario of SCENARIOS) {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
    await p.goto(`${SIM}/?sim=garage&scenario=${scenario}&env=${preset}&record=1`);
    await p.waitForSelector('body[data-lab-ready="1"]');
    await p.waitForFunction(() => window.__garageLab.streamer.health?.inference?.inference_ready, null, { timeout: 120000 });
    const rows = await p.evaluate(async ({ step }) => {
      const { lab, streamer } = window.__garageLab;
      streamer.sendGroundTruth = false;
      const encode = [];
      const original = lab.captureFrame.bind(lab);
      lab.captureFrame = async () => {
        const f = await original();
        encode.push({ ms: f.encodeMs, bytes: f.jpeg.size });
        return f;
      };
      const out = [];
      for (let t = 0; t <= lab.world.scenario.durationMs; t += step) {
        lab.world.setTime(t);
        const t0 = performance.now();
        // Wait out an in-flight frame (none expected: frames are sent one at a time).
        while (streamer.inFlight) await new Promise((r) => setTimeout(r, 50));
        const entry = await streamer.captureAndSend();
        const wall = performance.now() - t0;
        const rec = streamer.dataset.records.at(-1);
        const enc = encode.at(-1);
        const accepted = entry?.status === 'accepted' && rec && rec.metadata.seq === entry.seq;
        out.push({
          t, status: entry?.status ?? 'none', http: entry?.httpStatus ?? null, ingest_ms: entry?.latencyMs ?? null, wall_ms: Math.round(wall),
          encode_ms: enc ? Math.round(enc.ms) : null, jpeg_bytes: enc?.bytes ?? null,
          truth: accepted ? rec.ground_truth.spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id) : null,
          predicted: accepted ? rec.predictions.filter((o) => o.state === 'OCCUPIED').map((o) => o.space_id) : null,
          open: accepted ? rec.predictions.filter((o) => o.state === 'OPEN').map((o) => o.space_id) : null,
          detections: accepted ? (rec.diagnostics?.detections ?? []).map((d) => ({ label: d.label, confidence: +d.confidence.toFixed(3), box: d.box.map((v) => +v.toFixed(4)) })) : null,
          a2_ms: accepted ? Math.round(rec.diagnostics?.timings?.total_ms ?? 0) : null,
          moving: lab.world.truth().vehicles.filter((v) => v.moving).length,
        });
      }
      return out;
    }, { step: STEP });
    for (const r of rows) frames.push({ preset, scenario, ...r });
    const ok = rows.filter((r) => r.truth);
    console.log(`${preset.padEnd(9)} ${scenario.padEnd(18)} ${ok.length}/${rows.length} frames · load ${loadavg()[0].toFixed(1)}`);
    await p.close();
  }
}
await b.close();

// ---- metrics -------------------------------------------------------------------------
const CONF = 0.65; // the mapper's occupied-confidence threshold (reported, not changed)
function score(rows) {
  let tp = 0, fp = 0, fn = 0, tn = 0, open = 0;
  const conf = [];
  let vehDet = 0, a2 = [], ingest = [], encode = [], frames = 0;
  for (const r of rows) {
    if (!r.truth) continue;
    frames++;
    const T = new Set(r.truth), P = new Set(r.predicted);
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
      const t = T.has(id), p = P.has(id);
      if (t && p) tp++; else if (!t && p) fp++; else if (t && !p) fn++; else tn++;
    }
    open += r.open.length;
    const v = r.detections.filter((d) => ['car', 'truck', 'bus'].includes(d.label));
    vehDet += v.filter((d) => d.confidence >= CONF).length;
    conf.push(...v.filter((d) => d.confidence >= CONF).map((d) => d.confidence));
    a2.push(r.a2_ms); ingest.push(r.ingest_ms); encode.push(r.encode_ms);
  }
  const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
  const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  return {
    frames, bay_frames: tp + fp + fn + tn, tp, fp, fn, tn,
    occupied_precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null,
    occupied_recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null,
    false_occupied_rate: fp + tn ? +(fp / (fp + tn)).toFixed(3) : null,
    open_reported: open,
    vehicle_detections_per_frame: frames ? +(vehDet / frames).toFixed(2) : null,
    mean_vehicle_confidence: mean(conf),
    a2_ms: { mean: mean(a2), p50: pct(a2, 0.5), p95: pct(a2, 0.95) },
    ingest_ms: { mean: mean(ingest), p50: pct(ingest, 0.5), p95: pct(ingest, 0.95) },
    encode_ms: { mean: mean(encode), p95: pct(encode, 0.95) },
  };
}
const byPreset = Object.fromEntries(PRESETS.map((p) => [p, score(frames.filter((f) => f.preset === p))]));
const byScenario = Object.fromEntries(SCENARIOS.map((s) => [s, Object.fromEntries(PRESETS.map((p) => [p, score(frames.filter((f) => f.preset === p && f.scenario === s))]))]));
const fpBays = {};
for (const f of frames) if (f.truth) for (const id of f.predicted) if (!f.truth.includes(id)) fpBays[id] = (fpBays[id] ?? 0) + 1;
const fnBays = {};
for (const f of frames) if (f.truth) for (const id of f.truth) if (!f.predicted.includes(id)) fnBays[id] = (fnBays[id] ?? 0) + 1;
const summary = {
  schema: 'parkright-garage-a2-baseline-v1',
  created_at: new Date().toISOString(),
  sim_step_ms: STEP,
  mapper: 'production A2 mapper, unchanged: occupied conf 0.65, coverage 0.45, allow_open false',
  duration_s: Math.round((Date.now() - started) / 1000),
  overall: score(frames),
  by_preset: byPreset,
  by_scenario: byScenario,
  false_occupied_by_bay: fpBays,
  missed_occupied_by_bay: fnBays,
  frames_failed: frames.filter((f) => !f.truth).map((f) => ({ preset: f.preset, scenario: f.scenario, t: f.t, status: f.status, http: f.http })),
};
writeFileSync(`${out}/metrics.json`, JSON.stringify(summary, null, 2));
const csv = ['preset,scenario,t_ms,status,truth,predicted,vehicle_dets_ge_0.65,a2_ms,ingest_ms,encode_ms,jpeg_bytes,moving'];
for (const f of frames) csv.push([f.preset, f.scenario, f.t, f.status, (f.truth ?? []).join(' '), (f.predicted ?? []).join(' '), (f.detections ?? []).filter((d) => ['car', 'truck', 'bus'].includes(d.label) && d.confidence >= CONF).length, f.a2_ms, f.ingest_ms, f.encode_ms, f.jpeg_bytes, f.moving].join(','));
writeFileSync(`${out}/frames.csv`, csv.join('\n') + '\n');
writeFileSync(`${out}/frames.json`, JSON.stringify(frames));
console.log(JSON.stringify({ overall: summary.overall, by_preset: Object.fromEntries(Object.entries(byPreset).map(([k, v]) => [k, [v.occupied_precision, v.occupied_recall, v.a2_ms.mean]])) }, null, 1));
