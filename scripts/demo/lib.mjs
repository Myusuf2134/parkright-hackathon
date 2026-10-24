// Shared settings for the hackathon demo scripts (start, check, reset, stop).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Overridable so a second demo (for example the 3D garage under development) can run beside the stable one.
export const STATE_DIR = process.env.PARKRIGHT_DEMO_STATE_DIR || join(homedir(), '.cache/parkright/demo');
export const PID_FILE = join(STATE_DIR, 'processes.json');
export const LOG_DIR = join(STATE_DIR, 'logs');

const port = (name, fallback) => Number(process.env[name] || fallback);
export const PORTS = { api: port('PARKRIGHT_DEMO_API_PORT', 8400), sim: port('PARKRIGHT_DEMO_SIM_PORT', 5181), web: port('PARKRIGHT_DEMO_WEB_PORT', 5180) };
export const API = `http://127.0.0.1:${PORTS.api}`;
export const SIM = `http://127.0.0.1:${PORTS.sim}`;
export const WEB = `http://127.0.0.1:${PORTS.web}`;

export const CHECKPOINT = process.env.PARKRIGHT_A2_CHECKPOINT || join(homedir(), '.cache/parkright/models/a2-fasterrcnn/best.pt');
// Must match CHECKPOINT_SHA256 in services/perception/src/parkright_perception/a2/fasterrcnn.py.
export const CHECKPOINT_SHA256 = '43452092f0597922badc038c618dd5c76afc27d98be21688a2878f28b1c24985';

export const FIXTURE = join(ROOT, 'packages/shared/fixtures/hackathon-demo.json');
export const scenario = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
export const fixtureSha256 = () => createHash('sha256').update(readFileSync(FIXTURE)).digest('hex');

export const simulatorUrl = (hash = scenario().simulator.hash, garage = false) => (garage ? `${SIM}/?demo=1&sim=garage` : `${SIM}/?demo=1#${hash}`);
export const driverUrl = (extra = 'record=1') => `${WEB}/${extra ? `?${extra}` : ''}`;

export async function getJson(url, { timeout = 3000, method = 'GET' } = {}) {
  const res = await fetch(url, { method, signal: AbortSignal.timeout(timeout) });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

export async function reachable(url, timeout = 2000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 60000, interval = 500 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(interval);
  }
}
