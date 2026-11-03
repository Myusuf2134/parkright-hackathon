import type { Facility } from '@parkright/contracts';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../demo/api.ts';
import { directionsUrl, resolveMapsApp } from './directions.ts';
import { buildDirectory, matches, rankGarages, type GarageStatus } from './directory.ts';
import { garageTitle } from './names.ts';
import { pushRecent } from './saved.ts';

const facility = (id: string, over: Partial<Facility> = {}): Facility => ({
  facility_id: id, name: id, address: null, location: null, is_simulated: true, updated_at: null, levels: [], cameras: [],
  counts: { total: 12, open: 0, occupied: 0, uncertain: 12 }, ...over,
});
const cand = (id: string, walk: number, n: number) => ({ facility_id: id, name: `${id} name`, walking_minutes: walk, traffic: 'moderate', total_spaces: 100, demo_available_spaces: n, demo_space: { level: 'L', space_id: 'A' } });
const scenario = {
  camera_garage: 'tuttle', simulator: { facility_id: 'garage-01', camera_id: 'c', hash: '' },
  next_class: { time: '10:20 AM', course: 'C', destination: 'Dreese Laboratories', destination_short: 'Dreese Labs' },
  candidates: [cand('tuttle', 4, 46), cand('lane', 7, 23), cand('ohio-union-garage', 11, 31)],
} as unknown as Scenario;
const counts = (forYou: number) => ({ total: 12, open: forYou, forYou, occupied: 0, uncertain: 12 - forYou });

describe('directory', () => {
  const dir = buildDirectory([facility('garage-01'), facility('ohio', { name: 'Ohio Union North Garage-inspired simulation (72 spaces)' }), facility('deck')], scenario);
  it('merges a stand-in with its fixture garage so nothing is listed twice', () => {
    expect(dir.map((e) => e.id)).toEqual(['garage-01', 'ohio', 'deck', 'lane']);
    expect(dir[0]).toMatchObject({ source: 'simulated', standsInFor: 'tuttle name' });
    expect(dir[1].candidate?.facility_id).toBe('ohio-union-garage');
  });
  it('a virtual garage with no fixture link has no place to navigate to', () => {
    expect(dir[2].place).toBeNull();
    expect(dir[3]).toMatchObject({ source: 'demo', facility: null });
    expect(dir[3].place).toContain('lane name');
  });
  it('a physical facility with no spaces is unavailable, never available', () => {
    const [e] = buildDirectory([facility('lorex', { is_simulated: false, counts: { total: 0, open: 0, occupied: 0, uncertain: 0 } })], null);
    expect(e.source).toBe('unavailable');
    const [r] = rankGarages([{ entry: e, trusted: true, counts: counts(0), openDisabled: false }], { priority: 'closest', destinationIsClass: false });
    expect(r.tier).toBe(2);
  });
  it('a surveyed location is used as coordinates', () => {
    expect(buildDirectory([facility('x', { is_simulated: false, location: { x: -83, y: 40 } })], null)[0].place).toBe('40,-83');
  });
});

describe('ranking', () => {
  const [a, b, deck, lane] = buildDirectory([facility('garage-01'), facility('ohio', { name: 'Ohio Union sim' }), facility('deck')], scenario).map((entry) => ({ entry, trusted: true, counts: counts(3), openDisabled: false })) as GarageStatus[];
  const opts = { priority: 'closest' as const, destinationIsClass: true };
  it('closest uses the demo estimate; most-spaces uses confirmed count', () => {
    const list = [{ ...b, counts: counts(9) }, { ...a, counts: counts(2) }];
    expect(rankGarages(list, opts)[0].entry.id).toBe('garage-01');
    expect(rankGarages(list, { ...opts, priority: 'most-spaces' })[0].entry.id).toBe('ohio');
  });
  it('invents no walking time for any other destination', () => {
    const r = rankGarages([a, b], { ...opts, destinationIsClass: false });
    expect(r.every((x) => x.walkMinutes === null)).toBe(true);
    expect(r.flatMap((x) => x.reasons).join()).not.toMatch(/walk/);
  });
  it('real confirmed evidence outranks the demo feed, whatever its number', () => {
    expect(rankGarages([lane, { ...deck, counts: counts(1) }], opts)[0].entry.id).toBe('deck');
  });
  it('uncertain spaces, a lost connection and occupied-only detection are never recommended', () => {
    expect(rankGarages([{ ...a, counts: { total: 12, open: 0, forYou: 0, occupied: 0, uncertain: 12 } }], opts)[0].tier).toBe(2);
    expect(rankGarages([{ ...a, trusted: false }], opts)[0].tier).toBe(2);
    expect(rankGarages([{ ...a, openDisabled: true }], opts)[0].tier).toBe(2);
  });
  it('the demo feed is said to be not live', () => {
    expect(rankGarages([lane], opts)[0].reasons[0]).toContain('not live');
  });
  it('saved garages only break ties', () => {
    expect(rankGarages([a, deck], { priority: 'most-spaces', destinationIsClass: false, favorites: ['deck'] })[0].entry.id).toBe('deck');
  });
});

describe('search, names, recents, directions', () => {
  it('matches every word, in any order', () => {
    expect(matches('labs dreese', 'Dreese Labs')).toBe(true);
    expect(matches('dreese gym', 'Dreese Labs')).toBe(false);
  });
  it('shows the current brand without touching other names', () => {
    expect(garageTitle('ParkRight Virtual Garage')).toBe('Meridian Virtual Garage');
    expect(garageTitle('Ohio Union North Garage-inspired simulation (72 spaces)')).toBe('Ohio Union North Garage-inspired simulation');
  });
  it('recents are newest first, unique and bounded', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(pushRecent(['1', '2', '3', '4', '5'], '6')).toHaveLength(5);
  });
  it('builds real maps links with encoded places', () => {
    expect(directionsUrl('google', 'Tuttle Garage, OH')).toBe('https://www.google.com/maps/dir/?api=1&destination=Tuttle+Garage%2C+OH&travelmode=driving');
    expect(directionsUrl('apple', 'X', { from: 'G', mode: 'walking' })).toBe('https://maps.apple.com/?daddr=X&saddr=G&dirflg=w');
    expect(resolveMapsApp('auto', 'iPhone')).toBe('apple');
    expect(resolveMapsApp('auto', 'Android')).toBe('google');
    expect(resolveMapsApp('google', 'iPhone')).toBe('google');
  });
});
