import { describe, expect, it, vi } from 'vitest';
import drive from '../../../../e2e/routes/drive.json';
import { createProvider } from './index.ts';
import { mapboxProvider, parseMapbox } from './mapbox.ts';
import { osrmInstruction, osrmProvider, parseOsrm } from './osrm.ts';
import { RoutingError } from './types.ts';

const A = { lat: 40, lng: -83 }, B = { lat: 40.01, lng: -83.01 };
const respond = (body: unknown, status = 200) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('osrm', () => {
  it('parses a recorded real response without inventing traffic', () => {
    const [r] = parseOsrm(drive.routes as never, 'driving', 'osrm');
    expect(r.distance).toBe(drive.routes[0].distance);
    expect(r.duration).toBe(drive.routes[0].duration);
    expect(r.geometry.length).toBeGreaterThan(5);
    expect(r.trafficAware).toBe(false);
    expect(r.durationTypical).toBeNull();
    expect(r.steps.at(-1)!.type).toBe('arrive');
  });

  it('builds instructions only from the maneuver', () => {
    const s = (type: string, modifier?: string, name = 'Neil Avenue', exit?: number) => ({ distance: 1, duration: 1, name, maneuver: { type, modifier, exit, location: [0, 0] as [number, number] } });
    expect(osrmInstruction(s('turn', 'left'))).toBe('Turn left onto Neil Avenue');
    expect(osrmInstruction(s('turn', 'slight right', ''))).toBe('Bear right');
    expect(osrmInstruction(s('roundabout', 'right', 'Oval', 2))).toBe('At the roundabout, take the second exit onto Oval');
    expect(osrmInstruction(s('arrive', 'left'))).toBe('Arrive, on your left');
    expect(osrmInstruction(s('new name', 'straight'))).toBe('Continue on Neil Avenue');
    expect(osrmInstruction(s('depart', undefined, ''))).toBe('Head out');
  });

  it('asks each profile its own service and turns failures into typed errors', async () => {
    const p = osrmProvider('/r');
    const spy = respond(drive);
    await p.route({ profile: 'driving', from: A, to: B, alternatives: true });
    expect(String(spy.mock.calls[0][0])).toContain('/r/routed-car/route/v1/driving/-83.000000,40.000000;-83.010000,40.010000');
    expect(String(spy.mock.calls[0][0])).toContain('alternatives=true');
    respond(drive);
    await p.route({ profile: 'walking', from: A, to: B });
    const kinds: [unknown, number, string][] = [[{ code: 'NoRoute' }, 400, 'no-route'], [{ code: 'Ok', routes: [] }, 200, 'bad-response'], [{}, 429, 'rate-limit'], [{}, 403, 'auth']];
    for (const [body, status, kind] of kinds) {
      respond(body, status);
      await expect(p.route({ profile: 'driving', from: A, to: B })).rejects.toMatchObject({ kind });
    }
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(p.route({ profile: 'driving', from: A, to: B })).rejects.toBeInstanceOf(RoutingError);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(p.route({ profile: 'driving', from: A, to: B })).rejects.toMatchObject({ kind: 'bad-response' });
  });
});

describe('where a route really ends', () => {
  it('keeps how far the provider moved each end', async () => {
    respond({ ...drive, waypoints: [{ distance: 111 }, { distance: 38 }] });
    const [r] = await osrmProvider('/r').route({ profile: 'driving', from: A, to: B });
    expect(r).toMatchObject({ startGap: 111, endGap: 38 });
  });
});

describe('mapbox', () => {
  const body = { code: 'Ok', routes: [{ distance: 900, duration: 300, duration_typical: 240, geometry: { coordinates: [[-83, 40], [-83.01, 40.01]] }, legs: [{ summary: 'Lane Ave', steps: [{ distance: 900, duration: 300, name: 'Lane Ave', maneuver: { type: 'arrive', instruction: 'You have arrived', location: [-83.01, 40.01] } }] }] }] };

  it('marks driving as traffic-aware and keeps the provider instruction', () => {
    const [r] = parseMapbox(body.routes as never, 'driving');
    expect(r.trafficAware).toBe(true);
    expect(r.durationTypical).toBe(240);
    expect(r.steps[0].instruction).toBe('You have arrived');
    expect(parseMapbox(body.routes as never, 'walking')[0].trafficAware).toBe(false);
  });

  it('uses the driving-traffic profile', async () => {
    const spy = respond(body);
    await mapboxProvider('pk.test').route({ profile: 'driving', from: A, to: B });
    expect(String(spy.mock.calls[0][0])).toContain('/directions/v5/mapbox/driving-traffic/');
  });
});

describe('createProvider', () => {
  it('needs a token for traffic and says so', () => {
    expect(createProvider({}).supportsTraffic).toBe(false);
    expect(createProvider({ VITE_MAPBOX_TOKEN: 'pk.x' }).supportsTraffic).toBe(true);
  });
});
