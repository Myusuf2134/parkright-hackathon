import type { ParkingSpace } from '@parkright/contracts';
import { describe, expect, it } from 'vitest';
import { blind } from '../net/live.ts';
import { bayState, countSpaces, describeSpace, eligibility, layoutPlan, offerable, suggestSpace } from './parking.ts';
import { DEFAULT_PREFS } from './prefs.ts';
import { minusMinutes } from './time.ts';

const space = (id: string, over: Partial<ParkingSpace> = {}, x = 0.05, y = 0.08): ParkingSpace => ({
  space_id: id, facility_id: 'garage-01', level_id: 'L1', designation: 'standard',
  plan: { x, y, w: 0.13, h: 0.3 }, current_state: 'OPEN', confidence: 0.9,
  last_observed_at: '2026-10-27T10:00:00Z', source_camera_id: 'cam-01', stale: false, frame_seq: 1,
  model: { provider: 'a2', version: '1' }, ...over,
});

describe('offerable', () => {
  it('offers only fresh OPEN spaces', () => {
    expect(offerable(space('A1'), DEFAULT_PREFS)).toBe(true);
    expect(offerable(space('A1', { current_state: 'UNCERTAIN' }), DEFAULT_PREFS)).toBe(false);
    expect(offerable(space('A1', { current_state: 'OCCUPIED' }), DEFAULT_PREFS)).toBe(false);
  });
  it('never offers a stale space, even if it says OPEN', () => {
    expect(offerable(space('A1', { stale: true }), DEFAULT_PREFS)).toBe(false);
    expect(bayState(space('A1', { stale: true }))).toBe('uncertain');
  });
  it('never offers anything once the view is blind (disconnected)', () => {
    const spaces = [space('A1'), space('A2')];
    expect(blind(spaces).some((s) => offerable(s, DEFAULT_PREFS))).toBe(false);
  });
});

describe('eligibility', () => {
  it('needs a placard for accessible spaces and an EV for EV spaces', () => {
    expect(offerable(space('B6', { designation: 'accessible' }), DEFAULT_PREFS)).toBe(false);
    expect(offerable(space('B6', { designation: 'accessible' }), { ...DEFAULT_PREFS, accessiblePlacard: true })).toBe(true);
    expect(offerable(space('E1', { designation: 'ev' }), DEFAULT_PREFS)).toBe(false);
    expect(offerable(space('E1', { designation: 'ev' }), { ...DEFAULT_PREFS, vehicle: 'ev' })).toBe(true);
  });
  it('never offers reserved spaces, whatever the settings', () => {
    const all = { vehicle: 'ev' as const, accessiblePlacard: true, studentPermit: true, spaceAlerts: true };
    expect(eligibility('reserved', all).ok).toBe(false);
  });
  it('a self-reported permit unlocks nothing', () => {
    for (const d of ['accessible', 'ev', 'reserved'] as const) {
      expect(eligibility(d, { ...DEFAULT_PREFS, studentPermit: true }).ok).toBe(false);
    }
  });
  it('eligibility can narrow availability but never widen it', () => {
    const u = space('A1', { current_state: 'UNCERTAIN', designation: 'accessible' });
    expect(offerable(u, { ...DEFAULT_PREFS, accessiblePlacard: true })).toBe(false);
  });
});

describe('counts and suggestion', () => {
  const spaces = [
    space('A1', { current_state: 'OCCUPIED' }, 0.05), space('A2', {}, 0.2), space('A3', { current_state: 'UNCERTAIN' }, 0.35),
    space('B1', { designation: 'accessible' }, 0.05, 0.62), space('B2', { stale: true }, 0.2, 0.62),
  ];
  it('counts confirmed open separately from open-for-you', () => {
    expect(countSpaces(spaces, DEFAULT_PREFS)).toEqual({ total: 5, open: 2, forYou: 1, occupied: 1, uncertain: 2 });
  });
  it('suggests the first offerable space in reading order', () => {
    expect(suggestSpace(spaces, DEFAULT_PREFS)?.space_id).toBe('A2');
    expect(suggestSpace([space('A1', { current_state: 'UNCERTAIN' })], DEFAULT_PREFS)).toBeNull();
  });
  it('describes a space from geometry only', () => {
    expect(describeSpace(spaces[1], spaces)).toBe('Row A · 2nd from the left');
  });
});

describe('layoutPlan', () => {
  it('keeps bays tappable in big garages by widening the plan', () => {
    const many = Array.from({ length: 18 }, (_, i) => space(`A${i + 1}`, {}, 0.02 + i * 0.054, 0.1));
    for (const s of many) s.plan.w = 0.05;
    const p = layoutPlan(many, 346);
    expect(Math.min(...p.bays.map((b) => b.w))).toBeGreaterThanOrEqual(44);
    expect(p.width).toBeGreaterThan(346);
  });
  it('finds the drive aisle between two rows', () => {
    const two = [space('A1', {}, 0.05, 0.08), space('B1', {}, 0.05, 0.62)];
    expect(layoutPlan(two, 346).aisles).toHaveLength(1);
  });
});

describe('time', () => {
  it('subtracts minutes from a clock time', () => {
    expect(minusMinutes('10:20 AM', 8)).toBe('10:12 AM');
    expect(minusMinutes('12:05 PM', 10)).toBe('11:55 AM');
    expect(minusMinutes('nonsense', 3)).toBeNull();
  });
});
