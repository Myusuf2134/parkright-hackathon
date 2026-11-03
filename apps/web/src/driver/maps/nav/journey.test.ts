import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/types.ts';
import { JOURNEY_IDLE, journeyReducer as r, legEnd, NO_ENDS, type Journey, type JourneyTarget } from './journey.ts';

const route = (id: string): Route => ({ id, profile: 'driving', distance: 1, duration: 1, geometry: [[0, 0], [1, 1]], steps: [], summary: '', trafficAware: false, durationTypical: null, provider: 't' });
const garage = { id: 'g', name: 'G', lat: 1, lng: 1, hasEntrance: true, drive: [], walkFrom: () => [] };
const destination = { name: 'D', lat: 2, lng: 2, walkTo: () => [] };
const door = { lat: 9, lng: 9, kind: 'door' as const, side: 'west' };
const both: JourneyTarget = { garage, destination };
const ready = (t = both): Journey => r(r(JOURNEY_IDLE, { type: 'open', target: t, mode: 'drive' }), { type: 'routes', routes: [route('a'), route('b')], walkLeg: route('w'), walkLegFailed: false, ends: { ...NO_ENDS, driveTo: door } });

describe('journey', () => {
  it('opens loading, then offers routes', () => {
    const s = r(JOURNEY_IDLE, { type: 'open', target: both, mode: 'drive' });
    expect(s).toMatchObject({ phase: 'preview', load: { state: 'loading' }, routes: [] });
    expect(ready()).toMatchObject({ load: { state: 'ok' }, selected: 0 });
  });

  it('can only start with a route', () => {
    const empty = r(JOURNEY_IDLE, { type: 'open', target: both, mode: 'drive' });
    expect(r(empty, { type: 'start' }).phase).toBe('preview');
  });

  it('selects an alternative and navigates that one', () => {
    const s = r(ready(), { type: 'select', index: 1 });
    expect(r(s, { type: 'start' })).toMatchObject({ phase: 'navigating', route: { id: 'b' } });
    expect(r(s, { type: 'select', index: 9 })).toBe(s);
  });

  it('switching mode drops the old routes', () => {
    expect(r(ready(), { type: 'mode', mode: 'walk' })).toMatchObject({ mode: 'walk', routes: [], walkLeg: null, ends: NO_ENDS, load: { state: 'loading' } });
  });

  it('keeps nothing from a failed request and can retry', () => {
    const f = r(ready(), { type: 'routes-failed', kind: 'network' });
    expect(f).toMatchObject({ routes: [], load: { state: 'error', kind: 'network' } });
    expect(r(f, { type: 'loading' })).toMatchObject({ load: { state: 'loading' } });
  });

  it('goes from garage to walk to arrival', () => {
    const nav = r(ready(), { type: 'start' });
    const at = r(nav, { type: 'reached' });
    expect(at).toMatchObject({ phase: 'at-garage', walkLeg: { id: 'w' }, ends: { driveTo: door } });
    const walking = r(at, { type: 'start-walk', route: route('w2') });
    expect(walking).toMatchObject({ phase: 'navigating', leg: 'walk', route: { id: 'w2' } });
    expect(r(walking, { type: 'reached' }).phase).toBe('arrived');
  });

  it('with no destination, reaching the garage is the end', () => {
    const nav = r(ready({ garage, destination: null }), { type: 'start' });
    expect(r(nav, { type: 'reached' }).phase).toBe('arrived');
  });

  it('counts reroutes, and a failed one keeps the current route', () => {
    let s = r(ready(), { type: 'start' });
    s = r(s, { type: 'reroute-start' });
    expect(s).toMatchObject({ rerouting: true });
    const failed = r(s, { type: 'reroute-failed' });
    expect(failed).toMatchObject({ rerouting: false, rerouteFailed: true, route: { id: 'a' } });
    expect(r(s, { type: 'reroute-done', route: route('n') })).toMatchObject({ route: { id: 'n' }, reroutes: 1, rerouteFailed: false });
  });

  it('ignores actions from another phase', () => {
    expect(r(JOURNEY_IDLE, { type: 'start' })).toBe(JOURNEY_IDLE);
    expect(r(JOURNEY_IDLE, { type: 'reached' })).toBe(JOURNEY_IDLE);
    expect(r(ready(), { type: 'close' })).toBe(JOURNEY_IDLE);
  });

  it('sends a car to the garage and a walker to the destination', () => {
    expect(legEnd(both, 'drive', NO_ENDS)).toBe(garage);
    expect(legEnd(both, 'walk', NO_ENDS)).toBe(destination);
    expect(legEnd({ garage: null, destination }, 'drive', NO_ENDS)).toBe(destination);
    expect(legEnd({ garage, destination: null }, 'walk', NO_ENDS)).toBe(garage);
    expect(legEnd(both, 'drive', { ...NO_ENDS, driveTo: door })).toBe(door);
    expect(legEnd(both, 'walk', { ...NO_ENDS, walkTo: door })).toBe(door);
  });
});
