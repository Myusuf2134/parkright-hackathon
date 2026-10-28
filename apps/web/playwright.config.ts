import { defineConfig, devices } from '@playwright/test';

const WEB = 5191;
const LIVE = 8433;
/** More real-API runs (scripted provider): Ohio 72 spaces, Ohio detector-like (allow_open false), 34-space showcase. */
const SITES = [
  { name: 'ohio-live', api: 8434, web: 5192, args: '--site ohio --demo --stale-ms 30000' },
  { name: 'ohio-detector', api: 8435, web: 5193, args: '--site ohio --demo --detector-like --stale-ms 30000' },
  { name: 'showcase-live', api: 8436, web: 5194, args: '--site showcase --demo' },
];

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
    launchOptions: process.env.PARKRIGHT_CHROMIUM ? { executablePath: process.env.PARKRIGHT_CHROMIUM } : {},
  },
  projects: [
    { name: 'scripted', testMatch: /(driver|arrival|honesty)\.spec\.ts/ },
    { name: 'live', testMatch: /\/live\.spec\.ts$/ },
    ...SITES.map((x) => ({ name: x.name, testMatch: new RegExp(`/${x.name}\\.spec\\.ts$`), use: { baseURL: `http://127.0.0.1:${x.web}` }, metadata: { api: x.api } })),
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
