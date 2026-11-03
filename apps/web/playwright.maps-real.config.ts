/**
 * Meridian Maps against the real tile and directions services, on the dev server and on a production build.
 * Needs internet, and sends a handful of requests to shared public servers, so it isn't part of the default suite.
 *   npx playwright test -c playwright.maps-real.config.ts
 */
import { defineConfig, devices } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

process.env.PYTHONPATH = ['services/api/src', 'services/perception/src', 'packages/contracts/src', 'evaluation/src'].map((d) => resolve(import.meta.dirname, '../..', d)).join(':');
delete process.env.VITE_MAP_STYLE_LIGHT;
delete process.env.VITE_OSRM_BASE;

const API = 8447, DEV = 5197, PROD = 5198, LAN_API = 8448, LAN = 5199, LAN_HTTP = 5186;
const lanIp = Object.values(networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal)?.address ?? '127.0.0.1';
const env = { PARKRIGHT_API_URL: `http://127.0.0.1:${API}` };

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../node_modules/.cache/parkright-web-e2e-real',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['iPhone 15'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
  projects: [
    { name: 'dev-chromium', testMatch: /maps-real\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${DEV}`, browserName: 'chromium' } },
    { name: 'dev-webkit', testMatch: /maps-real\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${DEV}`, browserName: 'webkit' } },
    { name: 'prod-chromium', testMatch: /maps-real\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${PROD}`, browserName: 'chromium' } },
    { name: 'prod-webkit', testMatch: /maps-real\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${PROD}`, browserName: 'webkit' } },
    // The real launch path: this machine's network address, over HTTPS and over plain HTTP.
    { name: 'lan-webkit', testMatch: /maps-lan\.spec\.ts$/, use: { browserName: 'webkit', ignoreHTTPSErrors: true }, metadata: { https: `https://${lanIp}:${LAN}`, http: `http://${lanIp}:${LAN_HTTP}` } },
  ],
  webServer: [
    { command: `uv run --frozen python apps/web/e2e/student_api.py --port ${API} --interval 1`, cwd: '../..', url: `http://127.0.0.1:${API}/api/v1/health`, reuseExistingServer: false, timeout: 60_000 },
    { command: `npx vite --host 127.0.0.1 --port ${DEV} --strictPort`, url: `http://127.0.0.1:${DEV}/app/`, env, reuseExistingServer: false },
    { command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PROD} --strictPort`, url: `http://127.0.0.1:${PROD}/app/`, env, reuseExistingServer: false, timeout: 120_000 },
    { command: 'node scripts/demo/student.mjs --lan', cwd: '../..', env: { PARKRIGHT_STUDENT_API_PORT: String(LAN_API), PARKRIGHT_STUDENT_WEB_PORT: String(LAN) }, url: `https://127.0.0.1:${LAN}/app/`, ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 60_000 },
    { command: `npx vite --host 0.0.0.0 --port ${LAN_HTTP} --strictPort`, url: `http://127.0.0.1:${LAN_HTTP}/app/`, env: { PARKRIGHT_API_URL: `http://127.0.0.1:${LAN_API}` }, reuseExistingServer: false },
  ],
});
