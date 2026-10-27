import { describe, expect, it } from 'vitest';
import { departure, evaluate, judge, type TripContext } from './engine.ts';
import { buildScenarios, DEFAULT_SEED } from './scenarios.ts';
import type { Signal } from './types.ts';

const S = Object.fromEntries(buildScenarios().map((s) => [s.id, s]));
const ids = (xs: { signal: Signal }[]) => xs.map((x) => x.signal.id);

describe('next class and departure', () => {
  it('shows the next class from the schedule seed', () => {
    const r = evaluate(S.normal);
    expect(r.session).toMatchObject({ course: 'CSE 2421', startsAt: '10:20 AM', building: 'Dreese Laboratories', source: 'demo' });
  });
  it('normal day: leave at 9:58 with parking and walking included', () => {
    const r = evaluate(S.normal);
    expect(r.departure).toMatchObject({ state: 'ok', leaveAt: '9:58 AM', arriveBy: '10:15 AM', source: 'demo' });
    expect(r.note?.text).toBe('Parking and walking time included.');
    expect(r.shown).toHaveLength(0);
  });
  it('traffic on the route moves departure to 9:46', () => {
    const r = evaluate(S.traffic);
    expect(r.departure).toMatchObject({ state: 'ok', leaveAt: '9:46 AM' });
    expect(r.note?.text).toBe('Traffic on your route may add 12 minutes.');
  });
  it('never double counts traffic when the ETA already includes it', () => {
    const def = S.traffic;
    const relevant = evaluate(def).shown.map((j) => j.signal);
    const withProviderEta = departure({ session: def.session, route: { ...def.route, driveMinutes: 22, etaIncludesTraffic: true }, parkingMinutes: 3, walkMinutes: 4, bufferMinutes: 5, relevant });
    // 22 already contains the 12-minute delay: 22 + 3 + 4 + 5 = 34 → 9:46, not 9:34.
    expect(withProviderEta).toMatchObject({ state: 'ok', leaveAt: '9:46 AM', totalMinutes: 34 });
    expect(withProviderEta.state === 'ok' && withProviderEta.parts.map((p) => p.label)).not.toContain('Traffic');
  });
  it('snow adds drive and walk time', () => {
    expect(evaluate(S.weather).departure).toMatchObject({ state: 'ok', leaveAt: '9:50 AM' });
  });
  it('roadwork at the entrance surfaces with a route review', () => {
    const r = evaluate(S.construction);
    expect(ids(r.shown)).toEqual(['entrance-work']);
    expect(r.shown[0].signal.action).toBe('review-route');
    expect(r.departure).toMatchObject({ leaveAt: '9:53 AM' });
  });
});

describe('relevance filtering', () => {
  it('drops a highway closure that is not on the route', () => {
    const r = evaluate(S.traffic);
    expect(ids(r.shown)).toEqual(['route-crash']);
    expect(r.filtered.find((j) => j.signal.id === 'closure-elsewhere')?.reason).toMatch(/Not on your route/);
  });
  it('drops announcements about other classes', () => {
    const r = evaluate(S.traffic);
    expect(r.filtered.find((j) => j.signal.id === 'other-class')?.reason).toMatch(/not yours/);
  });
  it('does not raise light rain', () => {
    const r = evaluate(S.moved);
    expect(r.filtered.find((j) => j.signal.id === 'light-rain')?.reason).toMatch(/Only about 1 min/);
  });
  it('drops stale reports and events outside the travel window', () => {
    const r = evaluate(S.quiet);
    expect(r.shown).toHaveLength(0);
    expect(r.filtered).toHaveLength(5);
    expect(r.filtered.find((j) => j.signal.id === 'stale-crash')?.reason).toMatch(/Out of date/);
    expect(r.filtered.find((j) => j.signal.id === 'evening-work')?.reason).toMatch(/Outside your travel time/);
    expect(r.departure).toMatchObject({ leaveAt: '9:58 AM' }); // nothing filtered changed the time
  });
  it('drops low-confidence signals', () => {
    const ctx: TripContext = { session: S.normal.session, route: S.normal.route, travel: { fromMin: -60, toMin: 0 } };
    const weak: Signal = { id: 'w', kind: 'traffic', title: 't', detail: 'd', legs: ['Highway leg'], severity: 'major', driveDelayMin: 20, confidence: 0.3, minutesOld: 1, maxAgeMin: 30, source: 'demo' };
    expect(judge(weak, ctx)).toMatchObject({ relevant: false, reason: 'Low confidence' });
  });
});

describe('plan-changing announcements', () => {
  it('cancellation: no departure needed', () => {
    const r = evaluate(S.canceled);
    expect(r.canceled).toBe(true);
    expect(r.departure.state).toBe('not-needed');
    expect(r.shown[0].signal.action).toBe('dismiss-trip');
  });
  it('room change: new building, new walk, parking review', () => {
    const r = evaluate(S.moved);
    expect(r.movedTo?.building).toBe('Engineering Annex');
    expect(r.departure).toMatchObject({ state: 'ok', leaveAt: '9:55 AM' });
    expect(r.shown[0].signal.action).toBe('review-parking');
  });
});

describe('missing data and live parking', () => {
  it('without a drive estimate, says unavailable instead of guessing', () => {
    expect(evaluate(S.missing).departure).toEqual({ state: 'unavailable', missing: ['drive time'] });
  });
  it('live parking with nothing open becomes a live alert, and never makes the advice later', () => {
    const r = evaluate(S.normal, { trusted: true, open: 0, forYou: 0, garage: 'Garage', building: DEFAULT_SEED.building });
    expect(r.shown[0].signal).toMatchObject({ id: 'parking-none', source: 'live' });
    expect(r.departure).toMatchObject({ state: 'ok', leaveAt: '9:58 AM', incomplete: ['parking'] });
  });
  it('live parking paused (connection lost) is surfaced, never treated as available', () => {
    const r = evaluate(S.normal, { trusted: false, open: 7, forYou: 7, garage: 'Garage', building: DEFAULT_SEED.building });
    expect(r.shown[0].signal).toMatchObject({ id: 'parking-paused', source: 'live' });
  });
  it('live parking with open spaces adds no alert', () => {
    const r = evaluate(S.normal, { trusted: true, open: 7, forYou: 7, garage: 'Garage', building: DEFAULT_SEED.building });
    expect(r.shown).toHaveLength(0);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(evaluate(S.traffic))).toBe(JSON.stringify(evaluate(S.traffic)));
  });
});
