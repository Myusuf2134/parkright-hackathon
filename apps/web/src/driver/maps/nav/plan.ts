/**
 * Which door. A garage has several entrances and a building several doors, and only the routes tell you
 * which is closest from here, so each candidate is asked for and the fastest real one kept. Nothing is
 * drawn or estimated here: a leg is always what the provider returned, plus what's known about its ends.
 */
import type { Campus, CampusBuilding, CampusGarage, LatLng } from '../campus/types.ts';
import { RoutingError, type DirectionsProvider, type Profile, type Route } from '../routing/types.ts';
import { metres } from './geo.ts';

/** How a leg's end point is known. */
export type PointKind = 'entrance-inbound' | 'entrance-mapped' | 'garage-centre' | 'door' | 'building-centre' | 'vehicle-entrance';

export interface PlanPoint extends LatLng { kind: PointKind; side: string | null }

/** Candidates to drive to: entrances known to take traffic in, else any mapped, else the footprint. */
export function driveTargets(g: Pick<CampusGarage, 'lat' | 'lng' | 'entrances'>): PlanPoint[] {
  const inbound = g.entrances.filter((e) => e.kind === 'inbound');
  const list = inbound.length ? inbound : g.entrances;
  if (!list.length) return [{ lat: g.lat, lng: g.lng, kind: 'garage-centre', side: null }];
  return list.map((e) => ({ lat: e.lat, lng: e.lng, kind: e.kind === 'inbound' ? 'entrance-inbound' : 'entrance-mapped', side: e.side }));
}

const nearestTo = <T extends LatLng>(list: T[], to: LatLng, n: number) => [...list].sort((a, b) => metres(a, to) - metres(b, to)).slice(0, n);

/** Candidates to leave a garage on foot from: its mapped doors, else the entrances, else the footprint. */
export function walkStarts(g: Pick<CampusGarage, 'lat' | 'lng' | 'entrances' | 'pedestrianDoors'>, toward: LatLng): PlanPoint[] {
  if (g.pedestrianDoors.length) return nearestTo(g.pedestrianDoors, toward, 2).map((d) => ({ lat: d.lat, lng: d.lng, kind: 'door', side: d.side }));
  if (g.entrances.length) return nearestTo(g.entrances, toward, 1).map((e) => ({ lat: e.lat, lng: e.lng, kind: 'vehicle-entrance', side: e.side }));
  return [{ lat: g.lat, lng: g.lng, kind: 'garage-centre', side: null }];
}

/** Where to walk to at a building: its nearest mapped door, else its centre. */
export function walkEnds(b: Pick<CampusBuilding, 'lat' | 'lng' | 'doors'>, from: LatLng): PlanPoint[] {
  if (!b.doors.length) return [{ lat: b.lat, lng: b.lng, kind: 'building-centre', side: null }];
  return nearestTo(b.doors, from, 1).map((d) => ({ lat: d.lat, lng: d.lng, kind: 'door', side: null }));
}

export const WALK_MPS = 1.3;

/** Seconds a candidate really costs: the route, plus walking whatever gap it leaves at its end. */
export const routeCost = (r: Route) => r.duration + (r.endGap ?? 0) / WALK_MPS;

export interface Picked { routes: Route[]; from: PlanPoint; to: PlanPoint }

/** Tries every pairing and keeps the cheapest. One candidate failing is fine; all failing is the first failure. */
export async function bestRoute(provider: DirectionsProvider, profile: Profile, froms: PlanPoint[], tos: PlanPoint[], opts: { alternatives?: boolean; signal?: AbortSignal } = {}): Promise<Picked> {
  const pairs = froms.flatMap((from) => tos.map((to) => ({ from, to })));
  const settled = await Promise.allSettled(pairs.map((p) => provider.route({ profile, from: p.from, to: p.to, alternatives: opts.alternatives, signal: opts.signal })));
  let best: Picked | null = null;
  let firstError: unknown = null;
  settled.forEach((s, i) => {
    if (s.status === 'rejected') { firstError ??= s.reason; return; }
    if (!s.value.length) return;
    if (!best || routeCost(s.value[0]) < routeCost(best.routes[0])) best = { routes: s.value, ...pairs[i] };
  });
  if (best) return best;
  throw firstError ?? new RoutingError('no-route', 'no candidates');
}

const FT = 3.28084;
export const feet = (m: number) => `${Math.max(10, Math.round((m * FT) / 10) * 10)} ft`;
const BIG_GAP = 15;

/** One plain sentence on where a drive really ends. */
export function driveEndNote(to: PlanPoint | null, r: Route | null): string | null {
  if (!to) return null;
  const gap = r?.endGap ?? 0;
  const short = gap > BIG_GAP ? ` The route stops on the road about ${feet(gap)} from it.` : '';
  switch (to.kind) {
    case 'entrance-inbound': return `Ends at the ${to.side} vehicle entrance, from OpenStreetMap, not checked on site.${short}`;
    case 'entrance-mapped': return `Ends at the ${to.side} vehicle entrance, from OpenStreetMap. Its traffic direction isn't known, so it may be exit only.${short}`;
    default: return `No vehicle entrance is mapped for this garage, so the route ends on the nearest road${gap > BIG_GAP ? `, about ${feet(gap)} from its center` : ''}.`;
  }
}

/** One plain sentence on where a walk starts. */
export function walkStartNote(from: PlanPoint | null): string | null {
  if (!from) return null;
  switch (from.kind) {
    case 'door': return `Starts at the ${from.side} pedestrian door, from OpenStreetMap, not checked on site.`;
    case 'vehicle-entrance': return 'No pedestrian door is mapped here, so this starts at the vehicle entrance. Follow the signs inside the garage.';
    case 'garage-centre': return 'No door is mapped here, so this starts from the middle of the garage. Follow the signs inside.';
    default: return null;
  }
}

/** One plain sentence on where a walk ends. */
export function walkEndNote(to: PlanPoint | null, r: Route | null, name: string): string | null {
  if (!to) return null;
  const gap = r?.endGap ?? 0;
  if (to.kind === 'door') return `Ends at a door of ${name}, from OpenStreetMap${gap > BIG_GAP ? `. The path stops about ${feet(gap)} from it` : ''}.`;
  return `No door is mapped for ${name}, so this ends on the nearest path${gap > BIG_GAP ? `, about ${feet(gap)} from the building's center` : ''}.`;
}

/** Where a preview from a chosen start point really starts, when that's noticeably off. */
export const startNote = (r: Route | null, name: string | null): string | null => (r?.startGap && r.startGap > 25 && name ? `Starts on the nearest ${r.profile === 'driving' ? 'road' : 'path'}, about ${feet(r.startGap)} from the center of ${name}.` : null);

export type { Campus };
