import type { ParkingSpace } from '@parkright/contracts';
import { describe, expect, it } from 'vitest';
import { groupLabel, spaceAgeMs, spaceLabel, summarize } from './evidence.ts';
import { offerable } from './parking.ts';
import { DEFAULT_PREFS } from './prefs.ts';

const NOW = Date.parse('2026-10-27T10:00:30Z');
const seen = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const space = (id: string, over: Partial<ParkingSpace> = {}): ParkingSpace => ({
  space_id: id, facility_id: 'garage-01', level_id: 'L1', designation: 'standard',
  plan: { x: 0, y: 0, w: 0.1, h: 0.3 }, current_state: 'OCCUPIED', confidence: 0.9,
  last_observed_at: seen(1), source_camera_id: 'cam-01', stale: false, frame_seq: 1,
  model: { provider: 'a2', version: '1' }, ...over,
});

describe('per-space age', () => {
  it('uses the space’s own observation, corrected for clock offset', () => {
    expect(spaceAgeMs(space('A1', { last_observed_at: seen(17) }), NOW)).toBe(17_000);
    // Client clock 5 s ahead of the server: the same observation is still 17 s old.
    expect(spaceAgeMs(space('A1', { last_observed_at: seen(17) }), NOW + 5000, 5000)).toBe(17_000);
    expect(spaceAgeMs(space('A1', { last_observed_at: null }), NOW)).toBeNull();
  });
  it('a space last seen 17 s ago never reads as 1 s, even when another camera just reported', () => {
    expect(spaceLabel(space('B10', { last_observed_at: seen(17) }), NOW)).toEqual({ tone: 'aging', text: 'Seen 17 s ago' });
    expect(spaceLabel(space('A1', { last_observed_at: seen(1) }), NOW)).toEqual({ tone: 'live', text: 'Seen 1 s ago' });
  });
  it('a stale space says so', () => {
    expect(spaceLabel(space('A1', { last_observed_at: seen(40), stale: true, current_state: 'UNCERTAIN' }), NOW).tone).toBe('none');
  });
});

describe('garage summary', () => {
  // Eight cameras on a round robin: views from 1 to 18 s old.
  const ohio = Array.from({ length: 8 }, (_, cam) =>
    Array.from({ length: 9 }, (_, i) => space(`C${cam}-${i}`, { last_observed_at: seen(1 + cam * 2.4), current_state: i % 3 ? 'OCCUPIED' : 'UNCERTAIN' })),
  ).flat();

  it('is as old as its oldest current view, not its newest frame', () => {
    const e = summarize(ohio, NOW);
    expect(e.fresh).toBe(72);
    expect(Math.round(e.oldestMs! / 1000)).toBe(18);
    expect(groupLabel(e)).toEqual({ tone: 'aging', text: 'Camera views 1–18 s old' });
  });
  it('is Live only when every current view is under 12 s', () => {
    const e = summarize([space('A1', { last_observed_at: seen(2) }), space('A2', { last_observed_at: seen(9) })], NOW);
    expect(groupLabel(e)).toEqual({ tone: 'live', text: 'Live · 2–9 s' });
    expect(groupLabel(summarize([space('A1'), space('A2')], NOW)).text).toBe('Live · 1 s');
  });
  it('leaves stale spaces out of the age and counts them instead', () => {
    const e = summarize([space('A1'), space('A2', { last_observed_at: seen(40), stale: true })], NOW);
    expect(e).toMatchObject({ fresh: 1, stale: 1 });
    expect(Math.round(e.oldestMs! / 1000)).toBe(1);
  });
  it('says when there is no current view at all', () => {
    expect(groupLabel(summarize([space('A1', { stale: true })], NOW))).toEqual({ tone: 'none', text: 'No recent camera view' });
    expect(groupLabel(summarize([space('A1', { last_observed_at: null })], NOW)).text).toBe('Connected · no camera frames yet');
  });
  it('labels never change what may be offered', () => {
    const old = space('A1', { current_state: 'OPEN', last_observed_at: seen(17) });
    expect(offerable(old, DEFAULT_PREFS)).toBe(true); // the backend's stale window still decides
    expect(offerable({ ...old, stale: true }, DEFAULT_PREFS)).toBe(false);
  });
});
