#!/usr/bin/env node
// npm run demo:stop — stops the services started by npm run demo:hackathon (from any terminal).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { PID_FILE } from './lib.mjs';

if (!existsSync(PID_FILE)) {
  console.log('No demo is running (no process file).');
  process.exit(0);
}
const { children } = JSON.parse(readFileSync(PID_FILE, 'utf8'));
for (const c of children) {
  try {
    process.kill(-c.pid, 'SIGTERM');
    console.log(`✓ stopped ${c.name} (pid ${c.pid})`);
  } catch {
    console.log(`· ${c.name} was not running`);
  }
}
rmSync(PID_FILE, { force: true });
