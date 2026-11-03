/**
 * Every garage the app can talk about, and how to rank them. Two kinds exist:
 *
 *   monitored  a facility from /api/v1/facilities: per-space state over the WebSocket
 *   demo feed  a candidate from the demo fixture: a labelled example count, no spaces, never live
 *
 * A fixture candidate that a simulated facility stands in for is merged into it, so one garage is
 * never listed twice with two different numbers. Walking minutes exist only as demo estimates to the
 * fixture's class building; for any other destination they are null, never guessed.
 */
import type { Facility } from '@parkright/contracts';
import type { Candidate, Scenario } from '../../demo/api.ts';
import type { Counts } from './parking.ts';
import { garageTitle } from './names.ts';
import { primaryEntrance, type Campus, type CampusGarage, type LatLng } from '../maps/campus/index.ts';

export type DataSource = 'simulated' | 'live' | 'demo' | 'unavailable';

export interface GarageEntry {
  id: string;
  name: string;
  source: DataSource;
  facility: Facility | null;
  candidate: Candidate | null;
  /** What to hand a maps app, or null when the garage has no real place (a purely virtual garage). */
  place: string | null;
  /** Fixture name of the real garage a simulated one stands in for. */
  standsInFor: string | null;
  /** The real garage on the map. null for a garage with no real place (the demo deck). */
  geo: CampusGarage | null;
}

/** Where a car is sent: the mapped vehicle entrance, else the garage's own centre. */
export const entranceOf = (e: GarageEntry): LatLng | null => (e.geo ? primaryEntrance(e.geo) ?? { lat: e.geo.lat, lng: e.geo.lng } : null);

/** The fixture's disclaimer scopes its garages and buildings to this campus. */
const CAMPUS = 'The Ohio State University, Columbus, OH';
export const campusPlace = (name: string) => `${name}, ${CAMPUS}`;

export function sourceOf(f: Facility): DataSource {
  if (f.counts.total === 0) return 'unavailable';
  return f.is_simulated ? 'simulated' : 'live';
}

function linkedCandidate(f: Facility, scenario: Scenario | null | undefined): Candidate | null {
  if (!scenario || !f.is_simulated) return null;
  const by = (id: string) => scenario.candidates.find((c) => c.facility_id === id) ?? null;
  if (/^ohio union/i.test(f.name)) return by('ohio-union-garage');
  return f.facility_id === scenario.simulator.facility_id ? by(scenario.camera_garage) : null;
}

/** Monitored and demo-feed garages, each tied to its real place, then every other real garage with no data. */
export function buildDirectory(facilities: Facility[], scenario: Scenario | null | undefined, campus: Campus | null = null): GarageEntry[] {
  const used = new Set<string>();
  const taken = new Set<string>();
  const geoFor = (candidateId: string | null | undefined): CampusGarage | null => {
    const id = candidateId ? campus?.links.candidates[candidateId] : null;
    const g = id ? campus?.garages.find((x) => x.id === id) ?? null : null;
    if (g) taken.add(g.id);
    return g;
  };
  const monitored = facilities.map((f): GarageEntry => {
    const candidate = linkedCandidate(f, scenario);
    if (candidate) used.add(candidate.facility_id);
    const geo = geoFor(candidate?.facility_id ?? (/^ohio union/i.test(f.name) ? 'ohio-union-garage' : null));
    const entrance = geo ? primaryEntrance(geo) ?? geo : null;
    const real = entrance ? `${entrance.lat},${entrance.lng}` : f.location ? `${f.location.y},${f.location.x}` : f.address;
    return {
      id: f.facility_id, name: garageTitle(f.name), source: sourceOf(f), facility: f, candidate,
      place: real ?? (candidate ? campusPlace(candidate.name) : null),
      standsInFor: candidate?.name ?? geo?.name ?? null,
      geo,
    };
  });
  const demo = (scenario?.candidates ?? []).filter((c) => !used.has(c.facility_id)).map((c): GarageEntry => {
    const geo = geoFor(c.facility_id);
    const entrance = geo ? primaryEntrance(geo) ?? geo : null;
    return { id: c.facility_id, name: geo?.name ?? c.name, source: 'demo', facility: null, candidate: c, place: entrance ? `${entrance.lat},${entrance.lng}` : campusPlace(c.name), standsInFor: null, geo };
  });
  // Real garages Meridian has no data for: on the map with no number, never recommended.
  const others = (campus?.garages ?? []).filter((g) => !taken.has(g.id)).map((g): GarageEntry => {
    const entrance = primaryEntrance(g) ?? g;
    return { id: g.id, name: g.name, source: 'unavailable', facility: null, candidate: null, place: `${entrance.lat},${entrance.lng}`, standsInFor: null, geo: g };
  });
  return [...monitored, ...demo, ...others];
}

/** What one garage can say right now. */
export interface GarageStatus {
  entry: GarageEntry;
  /** Monitored garages: the live view can be trusted. Always false for the demo feed. */
  trusted: boolean;
  /** Monitored garages only; null until a snapshot arrives. */
  counts: Counts | null;
  openDisabled: boolean;
}

export type Priority = 'closest' | 'most-spaces';

export interface Ranked extends GarageStatus {
  tier: 0 | 1 | 2;
  /** Number behind the ranking: confirmed spaces this driver can use, or the demo feed's example count. */
  spaces: number | null;
  walkMinutes: number | null;
  /** routed: from the directions service. demo: the fixture's estimate. */
  walkSource: 'routed' | 'demo' | null;
  reasons: string[];
}

export const walkFor = (e: GarageEntry, destinationIsClass: boolean) => (destinationIsClass ? e.candidate?.walking_minutes ?? null : null);

/**
 * Tier 0: confirmed open and usable by this driver. Tier 1: demo feed example, always below real
 * evidence. Tier 2: nothing to offer; listed, never recommended. Uncertain spaces count for nothing.
 */
export function rankGarages(list: GarageStatus[], opts: { priority: Priority; destinationIsClass: boolean; favorites?: string[]; routedWalk?: Record<string, number> }): Ranked[] {
  const favorites = opts.favorites ?? [];
  const ranked = list.map((g): Ranked => {
    const routed = opts.routedWalk?.[g.entry.id] ?? null;
    const walkMinutes = routed ?? walkFor(g.entry, opts.destinationIsClass);
    const walkSource = routed !== null ? 'routed' : walkMinutes !== null ? 'demo' : null;
    const walk = walkMinutes !== null ? `${walkMinutes} min walk${routed === null ? ' · demo estimate' : ''}` : null;
    if (g.entry.source === 'demo') {
      const n = g.entry.candidate?.demo_available_spaces ?? 0;
      return { ...g, tier: n > 0 ? 1 : 2, spaces: n, walkMinutes, walkSource, reasons: [`${n} spaces in the demo feed, not live`, ...(walk ? [walk] : [])] };
    }
    if (g.entry.source === 'unavailable') return { ...g, tier: 2, spaces: null, walkMinutes, walkSource, reasons: [g.entry.facility ? 'No validated occupancy for this garage yet' : 'No availability data for this garage', ...(walk ? [walk] : [])] };
    if (!g.trusted || !g.counts) return { ...g, tier: 2, spaces: null, walkMinutes, walkSource, reasons: ['Live data unavailable right now'] };
    if (g.openDisabled) return { ...g, tier: 2, spaces: null, walkMinutes, walkSource, reasons: ['Empty spaces can’t be confirmed yet', ...(walk ? [walk] : [])] };
    const n = g.counts.forYou;
    if (n === 0) return { ...g, tier: 2, spaces: 0, walkMinutes, walkSource, reasons: ['No space you can use is confirmed open', ...(walk ? [walk] : [])] };
    return { ...g, tier: 0, spaces: n, walkMinutes, walkSource, reasons: [`${n} confirmed open for you`, ...(walk ? [walk] : [])] };
  });
  const walkKey = (r: Ranked) => r.walkMinutes ?? Number.POSITIVE_INFINITY;
  return ranked.sort((a, b) =>
    a.tier - b.tier
    || (opts.priority === 'closest' ? walkKey(a) - walkKey(b) : 0)
    || (b.spaces ?? -1) - (a.spaces ?? -1)
    || walkKey(a) - walkKey(b)
    || Number(favorites.includes(b.entry.id)) - Number(favorites.includes(a.entry.id))
    || a.entry.name.localeCompare(b.entry.name));
}

export interface Destination { name: string; short: string; line: string | null; isClass: boolean; terms?: string }

/** The schedule's class building first (demo data), then the campus's real buildings. */
export function knownDestinations(scenario: Scenario | null | undefined, campus: Campus | null = null): Destination[] {
  const c = scenario?.next_class;
  const cls: Destination[] = c ? [{ name: c.destination, short: c.destination_short, line: `${c.course} · ${c.time}`, isClass: true }] : [];
  const buildings = (campus?.buildings ?? [])
    .filter((b) => !c || !(c.destination_short === b.short || c.destination === b.name || findMatch(c.destination, b.name)))
    .map((b): Destination => ({ name: b.name, short: b.short, line: b.address, isClass: false, terms: b.terms }));
  return [...cls, ...buildings];
}

const findMatch = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
