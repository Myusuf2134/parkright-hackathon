import { describe, expect, it } from 'vitest';
import type { Facility } from '@parkright/contracts';
import { buildDirectory, entranceOf, knownDestinations, rankGarages, type GarageStatus } from '../../lib/directory.ts';
import { metres } from '../nav/geo.ts';
import { activeCampus, findBuilding, primaryEntrance } from './index.ts';

const osu = activeCampus();
const inCampus = (p: { lat: number; lng: number }) => metres(p, osu.center) < 5000;

describe('OSU data', () => {
  it('every record is traceable to OSM and on campus', () => {
    for (const x of [...osu.garages, ...osu.buildings]) {
      expect(x.osm).toMatch(/^(way|relation|node)\/\d+$/);
      expect(inCampus(x)).toBe(true);
    }
    expect(new Set(osu.garages.map((g) => g.id)).size).toBe(osu.garages.length);
  });

  it('entrances are real nodes next to their garage, inbound ones first', () => {
    for (const g of osu.garages) {
      for (const e of g.entrances) expect(metres(e, g)).toBeLessThan(250);
      for (const d of g.pedestrianDoors) expect(metres(d, g)).toBeLessThan(250);
      expect(g.footprint.length).toBeGreaterThan(3);
      const kinds = g.entrances.map((e) => e.kind);
      expect(kinds.lastIndexOf('inbound')).toBeLessThan(kinds.includes('mapped') ? kinds.indexOf('mapped') : Infinity);
    }
    expect(primaryEntrance(osu.garages.find((g) => g.id === 'osu-arps')!)).toMatchObject({ osmNode: 3948060906, kind: 'inbound', side: 'south' });
  });

  it('finds buildings from schedule text', () => {
    expect(findBuilding(osu, 'Dreese Labs')?.name).toBe('Dreese Laboratories');
    expect(findBuilding(osu, 'dreese laboratories')?.short).toBe('Dreese Labs');
    expect(findBuilding(osu, 'Nowhere Hall')).toBeNull();
    expect(findBuilding(osu, null)).toBeNull();
  });
});

describe('directory with a campus', () => {
  const sim = { facility_id: 'ohio-union-sim', name: 'Ohio Union North Garage-inspired simulation', is_simulated: true, location: null, address: null, counts: { total: 8 } } as unknown as Facility;
  const deck = { facility_id: 'demo-deck', name: 'Two-Level Demo Deck', is_simulated: true, location: null, address: null, counts: { total: 8 } } as unknown as Facility;

  it('ties a simulation to its real garage and never lists it twice', () => {
    const list = buildDirectory([sim], null, osu);
    expect(list.filter((e) => e.geo?.id === 'osu-union-north')).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'ohio-union-sim', source: 'simulated', standsInFor: expect.stringMatching(/Ohio Union North/) });
    expect(entranceOf(list[0])).toMatchObject({ osmNode: expect.any(Number) });
  });

  it('a virtual garage has no place on the map', () => {
    expect(buildDirectory([deck], null, osu)[0].geo).toBeNull();
  });

  it('other real garages are listed with no data and never recommended', () => {
    const list = buildDirectory([], null, osu);
    expect(list).toHaveLength(osu.garages.length);
    expect(list.every((e) => e.source === 'unavailable' && !e.facility)).toBe(true);
    const ranked = rankGarages(list.map((entry): GarageStatus => ({ entry, trusted: false, counts: null, openDisabled: false })), { priority: 'closest', destinationIsClass: false });
    expect(ranked.every((r) => r.tier === 2 && r.spaces === null)).toBe(true);
    expect(ranked[0].reasons[0]).toBe('No availability data for this garage');
  });

  it('routed walking times rank garages and say where they came from', () => {
    const list = buildDirectory([], null, osu);
    const statuses = list.map((entry): GarageStatus => ({ entry, trusted: false, counts: null, openDisabled: false }));
    const near = list[5].id;
    const ranked = rankGarages(statuses, { priority: 'closest', destinationIsClass: false, routedWalk: { [near]: 3 } });
    expect(ranked[0]).toMatchObject({ walkMinutes: 3, walkSource: 'routed' });
    expect(ranked[1]).toMatchObject({ walkMinutes: null, walkSource: null });
  });

  it('search covers the campus buildings', () => {
    expect(knownDestinations(null, osu).some((d) => d.name === 'Thompson Library')).toBe(true);
    expect(knownDestinations(null, null)).toEqual([]);
  });
});
