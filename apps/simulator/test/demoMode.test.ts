import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDemoMode, isDemoScene } from '../src/demo/demoMode.ts';
import { decodeSpec } from '../src/sim/spec.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/shared/fixtures/hackathon-demo.json', import.meta.url), 'utf8'));

describe('hackathon demo mode', () => {
  it('is enabled only by ?demo=1', () => {
    expect(isDemoMode('?demo=1')).toBe(true);
    expect(isDemoMode('')).toBe(false);
    expect(isDemoMode('?demo=0')).toBe(false);
  });

  it('decodes the fixture hash to the fixed seed, preset and parked bays', () => {
    const spec = decodeSpec(`#${fixture.simulator.hash}`);
    expect(spec.seed).toBe(fixture.simulator.seed);
    expect(spec.preset).toBe(fixture.simulator.environment);
    expect(Object.keys(spec.occupancy).sort()).toEqual([...fixture.simulator.occupied_bays].sort());
  });

  it('recognises the demo scene regardless of encoding, and nothing else', () => {
    const canonical = '#seed=4242&env=clear_day&occ=A1.0%2CA3.0%2CB2.0%2CB5.0&cam=10%2C10.5%2C25.5%2C0%2C-33%2C0%2C52%2C1280%2C720';
    expect(isDemoScene(canonical, fixture.simulator.hash)).toBe(true);
    expect(isDemoScene('#seed=4243&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0', fixture.simulator.hash)).toBe(false);
    expect(isDemoScene('#seed=4242&env=night&occ=A1.0,A3.0,B2.0,B5.0', fixture.simulator.hash)).toBe(false);
    expect(isDemoScene('#seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0', fixture.simulator.hash)).toBe(false);
  });
});
