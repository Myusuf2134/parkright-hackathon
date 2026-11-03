#!/usr/bin/env node
// npm run demo:student            API with simulated garages and traffic + student app, this computer only
// npm run demo:student -- --lan   also reachable from a phone on the same Wi-Fi, over HTTPS because phones
//                                  won't share location otherwise. --http turns that off.
//   --cert file --key file         use a certificate your phone trusts (see docs/meridian-maps.md) instead of a
//                                  throwaway self-signed one
// No A2 checkpoint or simulator window needed. For the real simulator → A2 path use npm run demo:ohio.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const lan = process.argv.includes('--lan');
const https = process.argv.includes('--https') || process.argv.includes('--cert') || (lan && !process.argv.includes('--http'));
const API = process.env.PARKRIGHT_STUDENT_API_PORT ?? '8400';
const WEB = process.env.PARKRIGHT_STUDENT_WEB_PORT ?? '5180';

// macOS can flag .venv files hidden, and Python then skips the editable-install .pth files.
const PYTHONPATH = ['services/api/src', 'services/perception/src', 'packages/contracts/src', 'evaluation/src'].map((d) => `${ROOT}${d}`).join(':');

const addresses = Object.values(networkInterfaces()).flat().filter((a) => a?.family === 'IPv4' && !a.internal).map((a) => a.address);

// A throwaway self-signed certificate for this machine's addresses. It lives under node_modules and is never committed.
const certEnv = {};
const flag = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const ownCert = flag('--cert'), ownKey = flag('--key');
if (Boolean(ownCert) !== Boolean(ownKey)) { console.error('--cert and --key go together.'); process.exit(2); }
if (ownCert) {
  for (const f of [ownCert, ownKey]) if (!existsSync(f)) { console.error(`Not found: ${f}`); process.exit(2); }
  certEnv.MERIDIAN_HTTPS_CERT = ownCert;
  certEnv.MERIDIAN_HTTPS_KEY = ownKey;
} else if (https) {
  const dir = `${ROOT}node_modules/.cache/meridian-https`;
  mkdirSync(dir, { recursive: true });
  const stamp = addresses.join('-') || 'local';
  const cert = `${dir}/${stamp}.crt`, key = `${dir}/${stamp}.key`;
  if (!existsSync(cert)) {
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((a) => `IP:${a}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=Meridian local demo', '-addext', `subjectAltName=${san}`, '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  certEnv.MERIDIAN_HTTPS_CERT = cert;
  certEnv.MERIDIAN_HTTPS_KEY = key;
}
const scheme = https ? 'https' : 'http';

const children = [
  spawn('uv', ['run', '--frozen', 'python', 'apps/web/e2e/student_api.py', '--port', API, '--traffic', '4'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PYTHONPATH } }),
  spawn('npx', ['vite', '--host', lan ? '0.0.0.0' : '127.0.0.1', '--port', WEB, '--strictPort'], { cwd: `${ROOT}apps/web`, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...certEnv, PARKRIGHT_API_URL: `http://127.0.0.1:${API}` } }),
];
let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
};
for (const c of children) c.on('exit', () => stop(1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`Meridian student app: ${scheme}://127.0.0.1:${WEB}/app/  (parking availability simulated; map and routes real)`);
if (lan) {
  for (const a of addresses) console.log(`On your phone (same Wi-Fi): ${scheme}://${a}:${WEB}/app/`);
  if (ownCert) console.log('Using your certificate. A phone that trusts its CA shows no warning.');
  else if (https) console.log('Self-signed certificate: your phone will warn, and Safari may withhold location. See docs/meridian-maps.md for a trusted one.');
  else console.log('Plain HTTP: this phone will not share its location, so guidance cannot start.');
}
console.log('Ctrl-C to stop.');
