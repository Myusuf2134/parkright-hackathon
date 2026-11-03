import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// macOS can flag .venv files hidden, and Python then skips the editable-install .pth files.
process.env.PYTHONPATH = ['services/api/src', 'services/perception/src', 'packages/contracts/src', 'evaluation/src'].map((d) => resolve(import.meta.dirname, '../..', d)).join(':');

// No basemap or directions traffic from the test suite. The real services are covered by playwright.maps-real.config.ts.
process.env.VITE_MAP_STYLE_LIGHT = 'blank';
process.env.VITE_OSRM_BASE = '/__routing';
process.env.VITE_MAPBOX_TOKEN = '';

const WEB = 5191;
const LIVE = 8433;
/** More real-API runs (scripted provider): Ohio 72 spaces, Ohio detector-like (allow_open false), 34-space showcase. */
const SITES = [
  { name: 'ohio-live', api: 8434, web: 5192, args: '--site ohio --demo --stale-ms 30000' },
  { name: 'ohio-detector', api: 8435, web: 5193, args: '--site ohio --demo --detector-like --stale-ms 30000' },
  { name: 'showcase-live', api: 8436, web: 5194, args: '--site showcase --demo' },
];

const STUDENT = { api: 8437, web: 5196 };

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../node_modules/.cache/parkright-web-e2e',
  use: {
    baseURL: `http://127.0.0.1:${WEB}`,
    ...devices['iPhone 15'],
    browserName: 'chromium',
    actionTimeout: 5_000,
    // Cloud sandboxes ship one preinstalled Chromium; elsewhere Playwright's own download is used.
    // Software WebGL, so the real map renders on machines and CI without a GPU.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.PARKRIGHT_CHROMIUM ? { executablePath: process.env.PARKRIGHT_CHROMIUM } : {}) },
  },
  projects: [
    { name: 'scripted', testMatch: /(driver|arrival|honesty|frame|student-states)\.spec\.ts/ },
    { name: 'live', testMatch: /\/live\.spec\.ts$/ },
    { name: 'student', testMatch: /\/student\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${STUDENT.web}` }, metadata: { api: STUDENT.api } },
    { name: 'student-webkit', testMatch: /\/student\.spec\.ts$/, use: { ...devices['iPhone 15'], browserName: 'webkit', baseURL: `http://127.0.0.1:${STUDENT.web}` } },
    { name: 'maps', testMatch: /\/maps\.spec\.ts$/, use: { baseURL: `http://127.0.0.1:${STUDENT.web}`, permissions: [] } },
    { name: 'maps-webkit', testMatch: /\/maps\.spec\.ts$/, use: { ...devices['iPhone 15'], browserName: 'webkit', baseURL: `http://127.0.0.1:${STUDENT.web}` } },
    { name: 'student-desktop', testMatch: /\/student\.desktop\.spec\.ts$/, use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${STUDENT.web}` } },
    ...SITES.map((x) => ({ name: x.name, testMatch: new RegExp(`/${x.name}(\\.present)?\\.spec\\.ts$`), use: { baseURL: `http://127.0.0.1:${x.web}` }, metadata: { api: x.api } })),
  ],
  webServer: [
    {
      // Real API + scripted provider; only the live project talks to it.
      command: `uv run --frozen python apps/web/e2e/live_api.py --site mvp --demo --port ${LIVE}`,
      cwd: '../..',
      url: `http://127.0.0.1:${LIVE}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB} --strictPort`,
      url: `http://127.0.0.1:${WEB}/app/`,
      env: { PARKRIGHT_API_URL: `http://127.0.0.1:${LIVE}` },
      reuseExistingServer: false,
    },
    {
      command: `uv run --frozen python apps/web/e2e/student_api.py --port ${STUDENT.api} --interval 1`,
      cwd: '../..',
      url: `http://127.0.0.1:${STUDENT.api}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${STUDENT.web} --strictPort`,
      url: `http://127.0.0.1:${STUDENT.web}/app/`,
      env: { PARKRIGHT_API_URL: `http://127.0.0.1:${STUDENT.api}` },
      reuseExistingServer: false,
    },
    ...SITES.flatMap((x) => [
      {
        command: `uv run --frozen python apps/web/e2e/live_api.py ${x.args} --port ${x.api}`,
        cwd: '../..',
        url: `http://127.0.0.1:${x.api}/api/v1/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
      {
        command: `npx vite --host 127.0.0.1 --port ${x.web} --strictPort`,
        url: `http://127.0.0.1:${x.web}/app/`,
        env: { PARKRIGHT_API_URL: `http://127.0.0.1:${x.api}` },
        reuseExistingServer: false,
      },
    ]),
  ],
});
