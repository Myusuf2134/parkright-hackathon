import { defineConfig, devices } from '@playwright/test';

// Tests the production build (vite preview) with no hosted URLs configured, as a fresh deploy would be.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../node_modules/.cache/parkright-site-e2e',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    browserName: 'chromium',
    launchOptions: process.env.PARKRIGHT_CHROMIUM ? { executablePath: process.env.PARKRIGHT_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 15'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
