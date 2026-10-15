import { defineConfig } from '@playwright/test';

/** Real API + real simulator, on ports that don't collide with a running dev setup. */
export const API_PORT = 8411;
export const SIM_PORT = 5191;
export const INGEST_TOKEN = 'e2e-ingest-token-0123456789';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${SIM_PORT}`,
    viewport: { width: 1600, height: 950 },
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      command: 'uv run --project ../.. python -m parkright_api',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: { PARKRIGHT_ENV: 'development', PARKRIGHT_PORT: String(API_PORT), PARKRIGHT_INGEST_TOKEN: INGEST_TOKEN },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite',
      url: `http://127.0.0.1:${SIM_PORT}`,
      env: { PARKRIGHT_API_URL: `http://127.0.0.1:${API_PORT}`, PARKRIGHT_SIM_PORT: String(SIM_PORT), PARKRIGHT_INGEST_TOKEN: INGEST_TOKEN },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
