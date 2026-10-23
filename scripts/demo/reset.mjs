#!/usr/bin/env node
// npm run demo:reset — back to the known starting state for a fresh take.
// Clears the API's occupancy evidence, stream history, cached frame and demo result; the
// simulator (?demo=1) and the driver demo screen notice the new epoch and reload/clear.
import { API, getJson, waitFor } from './lib.mjs';

const r = await getJson(`${API}/api/v1/demo/reset`, { method: 'POST' }).catch(() => null);
if (!r?.ok) {
  console.error('✗ Reset failed: is the demo running? (npm run demo:hackathon)');
  process.exit(1);
}
console.log(`✓ API reset (epoch ${r.body.epoch}, scenario ${r.body.scenario_id})`);
if (process.argv.includes('--no-wait')) process.exit(0);

process.stdout.write('  … waiting for the simulator to reload and stream fresh frames');
const ok = await waitFor(async () => {
  const s = (await getJson(`${API}/api/v1/demo/status`)).body;
  return s && s.epoch === r.body.epoch && s.frames_since_reset >= 2 && s.camera.fresh;
}, { timeout: 45000, interval: 1000 });
console.log(ok ? '\r  ✓ simulator reloaded; fresh frames are flowing                 ' : '\r  ! no fresh frames yet: is the simulator window open?             ');
process.exit(ok ? 0 : 1);
