// 3D garage browser checks against the RUNNING garage stack (npm run demo:hackathon:garage).
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  testDir: resolve(root, 'scripts/garage'),
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  outputDir: resolve(root, 'experiments/3d-garage-simulator/runs/artifacts'),
  reporter: [['list']],
  use: { viewport: { width: 1600, height: 1000 }, launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } },
});
