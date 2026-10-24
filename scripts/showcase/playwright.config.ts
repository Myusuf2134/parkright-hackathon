// Showcase browser checks against the RUNNING showcase stack (npm run demo:showcase).
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  testDir: resolve(root, 'scripts/showcase'),
  testMatch: /.*\.spec\.ts/,
  timeout: 240_000,
  workers: 1,
  outputDir: resolve(root, 'experiments/garage-showcase/runs/artifacts'),
  reporter: [['list']],
  use: { viewport: { width: 1680, height: 1000 }, launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
});
