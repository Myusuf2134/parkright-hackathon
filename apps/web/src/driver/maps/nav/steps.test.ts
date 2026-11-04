import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/types.ts';
import { advance, prepare, type Fix } from './engine.ts';
import { upcomingSteps } from './steps.ts';

const step = (instruction: string, distance: number, type = 'turn', modifier: string | null = 'left') =>
  ({ instruction, name: '', distance, duration: distance / 10, type, modifier, location: { lat: 40, lng: -83 } });

// East 852 m, north 556 m, east again 300 m, then arrive.
const route: Route = {
  id: 'r', profile: 'driving', distance: 1708, duration: 171, summary: '', trafficAware: false, durationTypical: null, provider: 't',
  geometry: [[-83.02, 40], [-83.01, 40], [-83.01, 40.005], [-83.0065, 40.005]],
  steps: [step('Head east on Lane Avenue', 852, 'depart', null), step('Turn left onto Tuttle Park Place', 556), step('Turn right onto Woody Hayes Drive', 300, 'turn', 'right'), step('Arrive at the garage', 0, 'arrive', null)],
};
const fix = (lat: number, lng: number, at: number): Fix => ({ lat, lng, accuracy: 8, heading: null, speed: null, at });

describe('upcoming maneuvers', () => {
  it('lists every later step in the provider order, starting with the next maneuver', () => {
    const list = upcomingSteps(route, { stepIndex: 0, toManeuver: 852 });
    expect(list.map((u) => u.step.instruction)).toEqual(['Turn left onto Tuttle Park Place', 'Turn right onto Woody Hayes Drive', 'Arrive at the garage']);
    expect(list.map((u) => u.index)).toEqual([1, 2, 3]);
  });

  it('measures each maneuver from the current position using the provider step lengths', () => {
    const list = upcomingSteps(route, { stepIndex: 0, toManeuver: 400 });
    expect(list.map((u) => u.distance)).toEqual([400, 956, 1256]);
  });

  it('follows real progress: after the first turn, it starts from the second', () => {
    const pr = prepare(route);
    const s1 = advance(null, pr, fix(40, -83.02, 0));
    const s2 = advance(s1, pr, fix(40.0025, -83.01, 60_000));
    expect(s2.stepIndex).toBe(1);
    const list = upcomingSteps(route, s2);
    expect(list[0].step.instruction).toBe('Turn right onto Woody Hayes Drive');
    expect(list[0].distance).toBeGreaterThan(200);
    expect(list[0].distance).toBeLessThan(330);
  });

  it('on the last leg, shows only the arrival', () => {
    const list = upcomingSteps(route, { stepIndex: 3, toManeuver: 20 });
    expect(list).toHaveLength(1);
    expect(list[0].step.type).toBe('arrive');
  });

  it('has nothing to show for a route without steps', () => {
    expect(upcomingSteps({ ...route, steps: [] }, null)).toEqual([]);
  });
});
