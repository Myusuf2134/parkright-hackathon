import { defineConfig, devices } from '@playwright/test';

const WEB = 5191;
const LIVE = 8433;

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
    { name: 'scripted', testMatch: /(driver|arrival)\.spec\.ts/ },
    { name: 'live', testMatch: 'live.spec.ts' },
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
  ],
});
