#!/usr/bin/env node
// npm run demo:hackathon          API (A2, demo mode, local fallback) + simulator + driver app
// npm run demo:hackathon:live     same, but the API calls NVIDIA Nemotron (needs NEBIUS_API_KEY)
// Add -- --open to open the two demo windows. Ctrl-C (or npm run demo:stop) stops everything.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API, CHECKPOINT, LOG_DIR, PID_FILE, PORTS, ROOT, SIM, STATE_DIR, WEB, driverUrl, getJson, reachable, simulatorUrl, waitFor,
} from './lib.mjs';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
// --garage: the 3D garage simulator and its CAM-01 calibration; default is the legacy simulator.
// --ohio: the Ohio Union North Garage-inspired simulation (72 spaces, eight cameras), a showcase site.
const ohio = args.has('--ohio');
const showcase = args.has('--showcase') || ohio;
const garage = args.has('--garage') || showcase;
// --showcase: the 34-space, four-camera garage (one calibration per camera); --garage: the 12-space garage.
const calibrationDir = join(
  ROOT,
  ohio ? 'packages/shared/calibration/ohio-union' : showcase ? 'packages/shared/calibration/garage-showcase' : garage ? 'packages/shared/calibration/garage' : 'packages/shared/calibration',
);
const showcaseUrl = ohio ? `${SIM}/?sim=ohio-union` : `${SIM}/?showcase=1&sim=garage`;
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// ---- preflight: things that otherwise fail halfway through a take -------------------
if (!existsSync(join(ROOT, '.venv'))) fail('Python environment missing. Run: uv sync --frozen --all-packages --all-extras --group dev');
if (!existsSync(join(ROOT, 'node_modules'))) fail('Node modules missing. Run: npm ci --ignore-scripts');
if (!existsSync(CHECKPOINT)) fail(`A2 checkpoint not found at ${CHECKPOINT}`);
if (live && !(process.env.NEBIUS_API_KEY ?? '').trim())
  fail('Live mode needs NEBIUS_API_KEY in this terminal (export it from your secrets manager), or run npm run demo:hackathon for the local fallback.');
for (const [name, port] of Object.entries(PORTS)) {
  if (await reachable(`http://127.0.0.1:${port}/`, 800)) fail(`Port ${port} (${name}) is already in use. Run npm run demo:stop, or stop whatever is using it.`);
}

mkdirSync(LOG_DIR, { recursive: true });
// A fresh local token per run, shared by the API and the simulator's dev proxy only. Never printed or saved.
const ingestToken = randomBytes(24).toString('hex');
const { NEBIUS_API_KEY, ...envWithoutKey } = process.env;

const services = [
  {
    name: 'api',
    cmd: 'uv',
    args: ['run', '--frozen', '--all-packages', '--all-extras', 'python', '-m', 'parkright_api.demo'],
    env: {
      ...envWithoutKey,
      ...(live ? { NEBIUS_API_KEY } : {}),
      PARKRIGHT_DEMO_MODE: '1',
      PARKRIGHT_DEMO_NEMOTRON: live ? 'live' : 'fallback',
      PARKRIGHT_PORT: String(PORTS.api),
      PARKRIGHT_PERCEPTION_PROVIDER: 'a2',
      PARKRIGHT_A2_CHECKPOINT: CHECKPOINT,
      PARKRIGHT_A2_DEVICE: process.env.PARKRIGHT_A2_DEVICE ?? 'cpu',
      ...(showcase ? { PARKRIGHT_SHOWCASE_DIR: calibrationDir } : { PARKRIGHT_CALIBRATION_FILE: join(calibrationDir, 'cam-01.json') }),
      PARKRIGHT_FACILITY_FIXTURES: JSON.stringify([join(calibrationDir, 'facility.json')]),
      PARKRIGHT_EVALUATION_ENABLED: 'false',
      // Under heavy CPU load one A2 frame can exceed the default 10 s. A late frame is already stale
      // (its bays read UNCERTAIN), so a longer limit only avoids dropped frames; it gates nothing.
      PARKRIGHT_PERCEPTION_TIMEOUT_S: '20',
      PARKRIGHT_INGEST_TOKEN: ingestToken,
      // Eight cameras share one A2 in round robin (~2 s a frame here), so each camera reports about
      // every 16–20 s. Bays go UNCERTAIN after 30 s without evidence instead of 12 s; this is the
      // facility's freshness window, not an A2 or mapper threshold.
      ...(ohio ? { PARKRIGHT_STALE_AFTER_MS: '30000' } : {}),
    },
  },
  {
    name: 'sim',
    cmd: 'npm',
    args: ['run', 'dev', '-w', '@parkright/simulator', '--', '--port', String(PORTS.sim)],
    env: { ...envWithoutKey, PARKRIGHT_API_URL: API, PARKRIGHT_INGEST_TOKEN: ingestToken },
  },
  {
    name: 'web',
    cmd: 'npm',
    args: ['run', 'dev', '-w', '@parkright/web', '--', '--host', '127.0.0.1', '--port', String(PORTS.web)],
    env: { ...envWithoutKey, PARKRIGHT_API_URL: API },
  },
];

const children = [];
let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {}
  }
  rmSync(PID_FILE, { force: true });
  setTimeout(() => process.exit(code), 800);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

console.log(`ParkRight hackathon demo · simulator: ${ohio ? 'Ohio Union North Garage-inspired simulation (72 spaces, 8 cameras)' : showcase ? '34-space showcase (4 cameras)' : garage ? '3D garage' : 'legacy'} · Nemotron mode: ${live ? 'LIVE (Nebius Token Factory)' : 'local fallback'}`);
for (const s of services) {
  const log = createWriteStream(join(LOG_DIR, `${s.name}.log`), { flags: 'w' });
  const child = spawn(s.cmd, s.args, { cwd: ROOT, env: s.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('exit', (code, signal) => {
    if (!stopping && (signal === 'SIGTERM' || code === 143)) {
      console.log(`\nStopped (${s.name} received SIGTERM, e.g. from npm run demo:stop).`);
      stopAll(0);
    } else if (!stopping) {
      console.error(`\n✗ ${s.name} exited (code ${code}). See ${join(LOG_DIR, `${s.name}.log`)}`);
      stopAll(1);
    }
  });
  children.push({ name: s.name, pid: child.pid });
}
mkdirSync(STATE_DIR, { recursive: true });
writeFileSync(PID_FILE, JSON.stringify({ started_at: new Date().toISOString(), live, garage, showcase, ohio, children }, null, 2), { mode: 0o600 });

const step = async (label, fn, timeout) => {
  process.stdout.write(`  … ${label}`);
  const ok = await waitFor(fn, { timeout });
  process.stdout.write(ok ? `\r  ✓ ${label}\n` : `\r  ✗ ${label}\n`);
  if (!ok) {
    console.error(`    Timed out. Logs: ${LOG_DIR}`);
    stopAll(1);
    await new Promise(() => {});
  }
};

await step(`API on :${PORTS.api}`, async () => (await getJson(`${API}/api/v1/health`)).ok, 90000);
await step('A2 detector loaded and warmed up', async () => (await getJson(`${API}/api/v1/demo/status`)).body?.perception?.loaded, 120000);
await step(`Simulator on :${PORTS.sim}`, () => reachable(SIM), 60000);
await step(`Driver app on :${PORTS.web}`, () => reachable(WEB), 60000);

console.log(`
Ready. Open these two windows (or start with -- --open):

  Simulator (camera):  ${showcase ? showcaseUrl : simulatorUrl(undefined, garage)}
  Driver app:          ${driverUrl()}

Before recording: npm run demo:check   ·   Fresh take: npm run demo:reset   ·   Stop: Ctrl-C or npm run demo:stop
Logs: ${LOG_DIR}
`);
if (args.has('--open')) {
  spawn('open', [showcase ? `${showcaseUrl}&present=1` : simulatorUrl(undefined, garage)], { stdio: 'ignore' });
  spawn('open', [driverUrl()], { stdio: 'ignore' });
}
await new Promise(() => {});
