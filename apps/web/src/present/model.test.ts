import type { ParkingSpace } from '@parkright/contracts';
import { describe, expect, it } from 'vitest';
import { detectorKind, garageTitle } from '../driver/lib/names.ts';
import { cameraTone, median, modeFrom, ownedRange, seconds, siteHeadline, tally } from './model.ts';

const sp = (id: string, current_state: ParkingSpace['current_state'], stale = false): ParkingSpace => ({
  space_id: id, facility_id: 'garage-01', level_id: 'L1', designation: 'standard', plan: { x: 0, y: 0, w: 0.1, h: 0.3 },
  current_state, confidence: current_state === 'UNCERTAIN' ? null : 0.9, last_observed_at: new Date().toISOString(),
  source_camera_id: 'cam-01', stale, frame_seq: 1, model: { provider: 'a2-fasterrcnn', version: '1' },
});

describe('presentation model', () => {
  it('defaults to the split view', () => {
    expect(modeFrom('')).toBe('split');
    expect(modeFrom('?mode=ai')).toBe('ai');
    expect(modeFrom('?mode=student')).toBe('student');
    expect(modeFrom('?mode=nonsense')).toBe('split');
  });
  it('headline keeps the site’s words and moves "simulation" into the SIMULATION mark', () => {
    expect(siteHeadline('Ohio Union North Garage-inspired simulation', null, true)).toEqual({ title: 'Ohio Union North Garage-inspired', simulation: true });
    expect(siteHeadline(null, 'ParkRight Showcase Garage (34 spaces)', true)).toEqual({ title: 'ParkRight Showcase Garage', simulation: true });
    expect(siteHeadline(null, 'Real Deck', false)).toEqual({ title: 'Real Deck', simulation: false });
  });
  it('garage titles drop only a size suffix', () => {
    expect(garageTitle('Ohio Union North Garage-inspired simulation (72 spaces)')).toBe('Ohio Union North Garage-inspired simulation');
    expect(garageTitle('Main Garage')).toBe('Main Garage');
  });
  it('names the detector honestly', () => {
    expect(detectorKind('a2-fasterrcnn')).toBe('a2');
    expect(detectorKind('scripted-test')).toBe('scripted');
    expect(detectorKind('none')).toBe('none');
    expect(detectorKind(undefined)).toBe('unknown');
  });
  it('counts like the driver app: a stale OPEN is never open', () => {
    expect(tally([sp('A1', 'OPEN'), sp('A2', 'OPEN', true), sp('A3', 'OCCUPIED'), sp('A4', 'UNCERTAIN')])).toEqual({ total: 4, open: 1, occupied: 1, uncertain: 2 });
  });
  it('latency helpers', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(seconds(180)).toBe('180 ms');
    expect(seconds(2527)).toBe('2.5 s');
  });
  it('camera freshness follows the 12 s rule, then the stale window', () => {
    expect(cameraTone(3, 30)).toBe('fresh');
    expect(cameraTone(17, 30)).toBe('aging');
    expect(cameraTone(40, 30)).toBe('stale');
    expect(cameraTone(null, 30)).toBe('none');
    expect(ownedRange(['A1', 'A2', 'A9'])).toBe('A1–A9');
  });
});
