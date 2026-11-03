import { describe, expect, it } from 'vitest';
import { polite } from './polite.ts';
import { RoutingError, type DirectionsProvider, type Route, type RouteRequest } from './types.ts';

const route = { id: 'r' } as Route;
const A = { lat: 40, lng: -83 };
const req = (lat = 41, signal?: AbortSignal): RouteRequest => ({ profile: 'walking', from: A, to: { lat, lng: -83 }, signal });
const base = (route_: DirectionsProvider['route']): DirectionsProvider => ({ id: 't', label: 't', attribution: '', supportsTraffic: false, route: route_ });

describe('polite provider', () => {
  it('never runs more than the limit at once, and runs them all', async () => {
    let now = 0, peak = 0, calls = 0;
    const p = polite(base(async () => { now++; calls++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 2)); now--; return [route]; }), { maxAtOnce: 3, spacingMs: 0 });
    await Promise.all(Array.from({ length: 12 }, (_, i) => p.route(req(41 + i))));
    expect(peak).toBe(3);
    expect(calls).toBe(12);
  });
  it('starts requests apart', async () => {
    const starts: number[] = [];
    const p = polite(base(async () => { starts.push(Date.now()); return [route]; }), { spacingMs: 30 });
    await Promise.all([p.route(req(41)), p.route(req(42)), p.route(req(43))]);
    expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(50);
  });
  it('reuses an answer, then asks again once it is old', async () => {
    let calls = 0, t = 0;
    const p = polite(base(async () => { calls++; return [route]; }), { now: () => t });
    await p.route(req()); await p.route(req());
    expect(calls).toBe(1);
    t = 6 * 60_000;
    await p.route(req());
    expect(calls).toBe(2);
  });
  it('retries a dropped connection once, and not a real answer', async () => {
    let calls = 0;
    const flaky = polite(base(async () => { if (++calls === 1) throw new RoutingError('network', 'x'); return [route]; }), { retryMs: 1 });
    expect(await flaky.route(req())).toEqual([route]);
    expect(calls).toBe(2);
    calls = 0;
    const none = polite(base(async () => { calls++; throw new RoutingError('no-route', 'x'); }), { retryMs: 1 });
    await expect(none.route(req())).rejects.toMatchObject({ kind: 'no-route' });
    expect(calls).toBe(1);
  });
  it('does not cache failures', async () => {
    let calls = 0;
    const p = polite(base(async () => { calls++; throw new RoutingError('no-route', 'x'); }));
    await p.route(req()).catch(() => {}); await p.route(req()).catch(() => {});
    expect(calls).toBe(2);
  });
  it('drops a queued request when it is cancelled, and the queue carries on', async () => {
    let release = () => {};
    const p = polite(base(() => new Promise((r) => { release = () => r([route]); })), { maxAtOnce: 1 });
    const first = p.route(req(41));
    const ctl = new AbortController();
    const second = p.route(req(42, ctl.signal));
    ctl.abort();
    await expect(second).rejects.toMatchObject({ kind: 'aborted' });
    release();
    await expect(first).resolves.toEqual([route]);
  });
});
