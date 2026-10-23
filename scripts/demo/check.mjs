#!/usr/bin/env node
// npm run demo:check — pre-recording validation of the running demo (start it with npm run demo:hackathon).
// Exit code 0 only when every check passes ("DEMO READY").
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { API, CHECKPOINT, CHECKPOINT_SHA256, SIM, WEB, fixtureSha256, getJson, reachable, scenario } from './lib.mjs';

const results = [];
const record = (status, name, detail = '') => results.push({ status, name, detail });
const pass = (n, d) => record('PASS', n, d);
const fail = (n, d) => record('FAIL', n, d);
const warn = (n, d) => record('WARN', n, d);

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

function websocketSnapshot(url, facilityId, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(`${url}/api/v1/realtime?facility_id=${facilityId}`);
    const finish = (v) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(v);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data));
        finish(msg.type === 'facility_snapshot' ? msg : null);
      } catch {
        finish(null);
      }
    };
    ws.onerror = () => finish(null);
    setTimeout(() => finish(null), timeout);
  });
}

const fx = scenario();
const expected = fx.expected;

// 1. API + demo mode
const health = await getJson(`${API}/api/v1/health`).catch(() => null);
if (!health?.ok) {
  fail('API', `not reachable on ${API}: start it with npm run demo:hackathon`);
} else {
  pass('API', `${API} healthy`);
}
const status = health?.ok ? (await getJson(`${API}/api/v1/demo/status`).catch(() => null)) : null;
const st = status?.ok ? status.body : null;
if (!health?.ok) {
  // nothing else can be checked
} else if (!st) {
  fail('demo mode', 'the API is not running in demo mode (use npm run demo:hackathon)');
} else if (st.fixture_sha256 !== fixtureSha256() || st.scenario_id !== fx.scenario_id) {
  fail('demo mode', 'the running API uses a different demo fixture than this checkout; restart the demo');
} else {
  pass('demo mode', `${st.scenario_id} · fixture ${st.fixture_sha256.slice(0, 12)}…`);
}

if (st) {
  // 2. Detector
  const p = st.perception;
  if (p.provider === 'a2-fasterrcnn' && p.loaded) pass('A2 detector', `${p.provider}@${p.version} ready`);
  else fail('A2 detector', `${p.provider} · ${p.phase}${p.artifact_error ? ` · ${p.artifact_error}` : ''}`);

  // 3. OPEN stays disabled: the running mapper's setting and the live bay states
  if (p.allow_open === false && st.camera.open.length === 0) pass('OPEN disabled', 'allow_open=false · no bay reported OPEN');
  else fail('OPEN disabled', `allow_open=${p.allow_open} · OPEN bays: ${st.camera.open.join(', ') || 'none'}`);
}

// 4. Checkpoint on disk
if (!existsSync(CHECKPOINT)) fail('checkpoint hash', `missing: ${CHECKPOINT}`);
else {
  const digest = await sha256(CHECKPOINT);
  digest === CHECKPOINT_SHA256 ? pass('checkpoint hash', `${digest.slice(0, 8)}…${digest.slice(-6)}`) : fail('checkpoint hash', `unexpected ${digest.slice(0, 12)}…`);
}

// 5–6. Simulator and web dev servers, each through its own /api proxy
for (const [name, base] of [['simulator', SIM], ['web', WEB]]) {
  const up = await reachable(base);
  const proxied = up ? await getJson(`${base}/api/v1/demo/scenario`).catch(() => null) : null;
  if (!up) fail(name, `not reachable on ${base}`);
  else if (!proxied?.ok) fail(name, `${base} is up but its /api proxy does not reach the demo API`);
  else pass(name, base);
}

// 7. WebSocket through the driver app's proxy
const snap = await websocketSnapshot(WEB.replace('http', 'ws'), fx.simulator.facility_id);
snap ? pass('websocket', `snapshot for ${fx.simulator.facility_id} (${snap.spaces.length} bays)`) : fail('websocket', 'no facility_snapshot over /api/v1/realtime');

// 8. Camera stream: the simulator tab is open and A2 has processed fresh frames
if (st) {
  const f = st.camera.last_frame;
  if (!f) warn('camera stream', `no frame since the last reset: open the simulator window (npm run demo:hackathon prints the URL)`);
  else if (!st.camera.fresh || f.age_s > 8) warn('camera stream', `last frame ${f.age_s}s ago: is the simulator window still open?`);
  else {
    const occ = [...st.camera.occupied].sort().join(',');
    const want = [...expected.camera_occupied_bays].sort().join(',');
    occ === want
      ? pass('camera stream', `frame ${f.seq} · ${f.detections.length} vehicles · occupied ${occ}`)
      : fail('camera stream', `occupied ${occ || 'none'}; the demo scene should give ${want}`);
  }
}

// 9. Recommendation end to end (calls Nemotron once in live mode)
if (st?.camera.fresh) {
  const r = await getJson(`${API}/api/v1/demo/recommendation`, { method: 'POST', timeout: 20000 }).catch(() => null);
  const pr = r?.body?.presentation;
  if (!r?.ok || !pr) fail('recommendation', `HTTP ${r?.status ?? 'error'}`);
  else if (pr.facility_id !== expected.facility_id || pr.level !== expected.level || pr.space_id !== expected.space_id || pr.walking_minutes !== expected.walking_minutes)
    fail('recommendation', `got ${pr.garage} ${pr.level} ${pr.space_id}`);
  else pass('recommendation', `${pr.garage} · ${pr.level} · ${pr.space_id} · ${pr.walking_minutes}-min walk · ${pr.source}`);

  // 10. Nemotron mode
  const n = st.nemotron;
  if (n.mode === 'live') {
    if (!n.live_configured) fail('live Nemotron', 'live mode requested but NEBIUS_API_KEY is not set on the API');
    else if (r?.body?.result?.provenance?.status === 'success') pass('live Nemotron', `${n.model} answered and passed validation`);
    else fail('live Nemotron', `configured, but the call fell back (${r?.body?.result?.provenance?.fallback_reason ?? 'no answer'})`);
  } else {
    pr?.source === 'fallback' ? pass('fallback mode', 'deterministic local logic; Nemotron is not called') : fail('fallback mode', 'fallback mode but the source was not the local fallback');
  }
} else if (st) {
  warn('recommendation', 'skipped: needs fresh camera evidence first (open the simulator window)');
  warn(st.nemotron.mode === 'live' ? 'live Nemotron' : 'fallback mode', 'not exercised yet');
}

// 11. CPU load: A2 runs on the CPU and slows sharply when the machine is busy
{
  const [one] = loadavg();
  const cores = availableParallelism();
  const ms = st?.camera.last_frame?.timings?.total_ms;
  if (one > cores) warn('CPU load', `load ${one.toFixed(1)} on ${cores} cores: close apps / wait for indexing before recording`);
  else if (ms && ms > 4000) warn('CPU load', `last A2 frame took ${(ms / 1000).toFixed(1)} s`);
  else pass('CPU load', `load ${one.toFixed(1)} on ${cores} cores${ms ? ` · A2 ${(ms / 1000).toFixed(1)} s/frame` : ''}`);
}

// 12. Stale or broken state
if (st) {
  const f = st.camera.last_frame;
  const problems = [];
  if (st.camera.live_bays && st.camera.live_bays !== 12) problems.push(`${st.camera.live_bays}/12 bays live`);
  if (f && f.age_s > 30) problems.push(`last frame ${f.age_s}s old`);
  problems.length ? warn('state', `${problems.join(' · ')}: run npm run demo:reset`) : pass('state', `epoch ${st.epoch} · ${st.frames_since_reset} frames since reset`);
}

console.log('\nParkRight Demo Check\n');
for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
const failed = results.some((r) => r.status === 'FAIL');
const warned = results.some((r) => r.status === 'WARN');
console.log(failed ? '\nNOT READY\n' : warned ? '\nNOT READY (see warnings)\n' : '\nDEMO READY\n');
process.exit(failed || warned ? 1 : 0);
