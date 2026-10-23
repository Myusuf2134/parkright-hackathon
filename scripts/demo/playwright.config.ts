// Reliability runs against the RUNNING demo (start it first with npm run demo:hackathon).
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  testDir: resolve(root, 'scripts/demo'),
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  outputDir: resolve(root, 'experiments/hackathon-demo/runs/artifacts'),
  reporter: [['list']],
  use: { viewport: { width: 1600, height: 1000 }, launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
});
