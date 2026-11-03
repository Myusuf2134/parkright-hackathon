import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/types.ts';
import { advance, canReroute, prepare, remainingGeometry, type Fix, type NavState } from './engine.ts';
import { formatDistance, formatDuration, metres } from './geo.ts';

// A straight 2-step route east along a parallel, then north. About 850 m + 556 m.
const route: Route = {
  id: 'r', profile: 'driving', distance: 1406, duration: 200, summary: '', trafficAware: false, durationTypical: null, provider: 't',
  geometry: [[-83.02, 40], [-83.01, 40], [-83.01, 40.005]],
  steps: [
    { instruction: 'Head east', name: '', distance: 852, duration: 120, type: 'depart', modifier: null, location: { lat: 40, lng: -83.02 } },
    { instruction: 'Turn left', name: '', distance: 556, duration: 80, type: 'turn', modifier: 'left', location: { lat: 40, lng: -83.01 } },
    { instruction: 'Arrive', name: '', distance: 0, duration: 0, type: 'arrive', modifier: null, location: { lat: 40.005, lng: -83.01 } },
  ],
};
const pr = prepare(route);
const fix = (lat: number, lng: number, at: number, accuracy = 8): Fix => ({ lat, lng, accuracy, heading: null, speed: null, at });
const run = (fixes: Fix[], start: NavState | null = null) => fixes.reduce<NavState | null>((s, f) => advance(s, pr, f), start)!;

describe('route progress', () => {
  it('counts down distance and time from real fixes', () => {
    const a = run([fix(40, -83.02, 0)]);
    expect(a.along).toBeLessThan(2);
    expect(a.remaining).toBeCloseTo(pr.length, -1);
    expect(a.remainingSeconds).toBeCloseTo(200, 0);
    const b = run([fix(40, -83.02, 0), fix(40, -83.015, 30_000)]);
    expect(b.remaining).toBeLessThan(a.remaining - 400);
    expect(b.remainingSeconds).toBeCloseTo(140, -1);
    expect(b.stepIndex).toBe(0);
    expect(b.toManeuver).toBeCloseTo(426, -1);
  });

  it('moves to the next step past the maneuver', () => {
    const s = run([fix(40, -83.02, 0), fix(40.001, -83.01, 60_000)]);
    expect(s.stepIndex).toBe(1);
    expect(s.offRoute).toBe(false);
  });

  it('does not move when no fix arrives, or jump backwards', () => {
    const a = run([fix(40, -83.015, 0)]);
    const b = advance(a, pr, fix(40, -83.0151, 5000));
    expect(b.along).toBeGreaterThan(a.along - 6);
  });

  it('draws only what is still ahead', () => {
    const s = run([fix(40, -83.015, 0)]);
    const g = remainingGeometry(pr, s);
    expect(g[0][0]).toBeCloseTo(-83.015, 3);
    expect(g).toHaveLength(3);
    expect(g.at(-1)).toEqual([-83.01, 40.005]);
  });
});

describe('off route', () => {
  const away = (t: number, accuracy = 8) => fix(40.003, -83.018, t, accuracy); // about 330 m north of the road
  it('needs three good fixes, not one', () => {
    const start = run([fix(40, -83.02, 0)]);
    const one = advance(start, pr, away(5000));
    expect(one.offRoute).toBe(false);
    expect(advance(one, pr, away(10_000)).offRoute).toBe(false);
    expect(advance(advance(one, pr, away(10_000)), pr, away(15_000)).offRoute).toBe(true);
  });

  it('forgives a brief wander', () => {
    let s = run([fix(40, -83.02, 0)]);
    s = advance(s, pr, away(5000));
    s = advance(s, pr, fix(40, -83.0195, 9000));
    expect(s.awayCount).toBe(0);
  });

  it('does not judge the route on a weak fix', () => {
    let s = run([fix(40, -83.02, 0)]);
    for (const t of [5000, 10_000, 15_000, 20_000]) s = advance(s, pr, away(t, 200));
    expect(s.weak).toBe(true);
    expect(s.offRoute).toBe(false);
    expect(s.along).toBeLessThan(2);
  });

  it('holds a poor but usable fix to a wider corridor', () => {
    const near = fix(40.0005, -83.015, 5000, 60); // about 55 m off the road
    expect(run([fix(40, -83.02, 0), near, { ...near, at: 10_000 }, { ...near, at: 15_000 }]).offRoute).toBe(false);
  });

  it('rate-limits reroutes', () => {
    let s = run([fix(40, -83.02, 0)]);
    for (const t of [5000, 10_000, 15_000]) s = advance(s, pr, away(t));
    expect(canReroute(s, 0, 20_000)).toBe(true);
    expect(canReroute(s, 15_000, 20_000)).toBe(false);
    expect(canReroute({ ...s, offRoute: false }, 0, 20_000)).toBe(false);
  });
});

describe('arrival', () => {
  it('arrives near the end, and not merely near it in a straight line early on', () => {
    expect(run([fix(40, -83.02, 0), fix(40.004, -83.01, 60_000), fix(40.0049, -83.01, 70_000)]).arrived).toBe(true);
    expect(run([fix(40, -83.02, 0), fix(40, -83.012, 40_000)]).arrived).toBe(false);
  });
  it('does not arrive on a weak fix', () => {
    expect(run([fix(40, -83.02, 0), { ...fix(40.005, -83.01, 60_000), accuracy: 300 }]).arrived).toBe(false);
  });
});

describe('format', () => {
  it('uses US units', () => {
    expect(formatDistance(30)).toBe('100 ft');
    expect(formatDistance(1609)).toBe('1.0 mi');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(metres({ lat: 40, lng: -83 }, { lat: 40.001, lng: -83 })).toBeCloseTo(111, 0);
  });
});
