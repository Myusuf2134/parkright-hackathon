import { describe, expect, it } from 'vitest';
import type { DirectionsProvider, Route, RouteRequest } from '../routing/types.ts';
import { RoutingError } from '../routing/types.ts';
import { activeCampus } from '../campus/index.ts';
import { bestRoute, driveEndNote, driveTargets, walkEndNote, walkEnds, walkStartNote, walkStarts, type PlanPoint } from './plan.ts';

const route = (duration: number, endGap = 0): Route => ({ id: String(duration), profile: 'driving', distance: duration * 10, duration, geometry: [[0, 0], [1, 1]], steps: [], summary: '', trafficAware: false, durationTypical: null, provider: 't', endGap });
const pt = (lat: number, kind: PlanPoint['kind'] = 'entrance-inbound'): PlanPoint => ({ lat, lng: 0, kind, side: 'west' });
const provider = (f: (r: RouteRequest) => Route[] | Error): DirectionsProvider => ({ id: 't', label: 't', attribution: '', supportsTraffic: false, route: async (r) => { const v = f(r); if (v instanceof Error) throw v; return v; } });
const osu = activeCampus();
const north = osu.garages.find((g) => g.id === 'osu-union-north')!;

describe('Ohio Union North', () => {
  it('sends cars to its own two inbound entrances, not the South garage or an exit', () => {
    expect(driveTargets(north).map((t) => t.side).sort()).toEqual(['east', 'west']);
    const nodes = north.entrances.map((e) => e.osmNode);
    expect(nodes).toEqual(expect.arrayContaining([332471337, 4424562779]));
    expect(nodes).not.toContain(4424563590); // driveway only flows out
    expect(nodes).not.toContain(12391672817); // driveway only flows out
    expect(nodes).not.toContain(12391670099); // belongs to Ohio Union South
  });

  it('leaves on foot from a mapped pedestrian door', () => {
    const stadium = osu.buildings.find((b) => b.short === 'Stadium')!;
    const starts = walkStarts(north, stadium);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every((s) => s.kind === 'door')).toBe(true);
    expect(starts[0].side).toBe('west');
    expect(walkEnds(stadium, north).every((d) => d.kind === 'door')).toBe(true);
  });
});

describe('fallbacks say so', () => {
  it('a garage with no doors starts at the entrance; with nothing mapped, the centre', () => {
    const g = { lat: 1, lng: 1, pedestrianDoors: [], entrances: [{ lat: 1, lng: 2, kind: 'mapped' as const, side: 'east', osmNode: 1, maxHeight: null }] };
    expect(walkStarts(g, { lat: 0, lng: 0 })[0].kind).toBe('vehicle-entrance');
    expect(walkStartNote(walkStarts(g, { lat: 0, lng: 0 })[0])).toContain('No pedestrian door');
    expect(walkStarts({ ...g, entrances: [] }, { lat: 0, lng: 0 })[0].kind).toBe('garage-centre');
    expect(driveTargets({ ...g, entrances: [] })[0].kind).toBe('garage-centre');
    expect(driveTargets(g)[0].kind).toBe('entrance-mapped');
    expect(driveEndNote(driveTargets(g)[0], null)).toContain('may be exit only');
    expect(driveEndNote(driveTargets({ ...g, entrances: [] })[0], null)).toContain('No vehicle entrance');
  });
  it('a building with no doors ends at its centre, and a gap is stated', () => {
    const to = walkEnds({ lat: 1, lng: 1, doors: [] }, { lat: 0, lng: 0 })[0];
    expect(to.kind).toBe('building-centre');
    expect(walkEndNote(to, route(1, 100), 'X')).toMatch(/No door is mapped for X.*330 ft/);
    expect(driveEndNote(pt(1), route(1, 38))).toContain('about 120 ft');
    expect(driveEndNote(pt(1), route(1, 5))).not.toContain('stops');
  });
});

describe('bestRoute', () => {
  it('keeps the fastest candidate, not the first', async () => {
    const r = await bestRoute(provider((q) => [route(q.to.lat === 2 ? 60 : 300)]), 'driving', [pt(0)], [pt(1), pt(2)]);
    expect(r.routes[0].duration).toBe(60);
    expect(r.to.lat).toBe(2);
  });
  it('counts the walk across a gap', async () => {
    const r = await bestRoute(provider((q) => [q.to.lat === 2 ? route(60, 500) : route(100, 0)]), 'driving', [pt(0)], [pt(1), pt(2)]);
    expect(r.to.lat).toBe(1);
  });
  it('survives one failing candidate, and reports when all fail', async () => {
    const some = provider((q) => (q.to.lat === 1 ? new RoutingError('no-route', 'x') : [route(5)]));
    expect((await bestRoute(some, 'driving', [pt(0)], [pt(1), pt(2)])).to.lat).toBe(2);
    await expect(bestRoute(provider(() => new RoutingError('network', 'x')), 'driving', [pt(0)], [pt(1)])).rejects.toMatchObject({ kind: 'network' });
  });
  it('returns exactly what the provider returned', async () => {
    const r0 = route(9);
    expect((await bestRoute(provider(() => [r0]), 'driving', [pt(0)], [pt(1)])).routes[0]).toBe(r0);
  });
});
