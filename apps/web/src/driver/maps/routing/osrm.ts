/**
 * OSRM's route API. Keyless by default, against the FOSSGIS servers (best effort, for demos). Durations
 * are free-flow: OSRM has no live traffic, so routes from here are never labelled as traffic-aware.
 */
import type { LatLng } from '../campus/types.ts';
import { fetchRouteJson } from './fetch.ts';
import { RoutingError, type DirectionsProvider, type Profile, type Route, type RouteRequest, type RouteStep } from './types.ts';

interface OsrmStep {
  distance: number; duration: number; name?: string; ref?: string; destinations?: string;
  maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
}
interface OsrmRoute { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { summary?: string; steps: OsrmStep[] }[] }

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** Words for an OSRM maneuver. Everything in the sentence comes from the response itself. */
export function osrmInstruction(step: OsrmStep): string {
  const { type, modifier, exit } = step.maneuver;
  const road = step.name || step.ref || '';
  const on = road ? ` onto ${road}` : '';
  const dir = modifier ?? 'straight';
  const turn = dir === 'straight' ? 'Continue straight' : dir === 'uturn' ? 'Make a U-turn' : dir.startsWith('slight') ? `Bear ${dir.slice(7)}` : dir.startsWith('sharp') ? `Turn sharp ${dir.slice(6)}` : `Turn ${dir}`;
  switch (type) {
    case 'depart': return road ? `Head out on ${road}` : 'Head out';
    case 'arrive': return modifier === 'left' || modifier === 'right' ? `Arrive, on your ${modifier}` : 'Arrive';
    case 'turn': case 'end of road': case 'continue': case 'new name': case 'notification':
      return type === 'new name' || (type === 'continue' && dir === 'straight') ? (road ? `Continue on ${road}` : 'Continue') : `${turn}${on}`;
    case 'merge': return `Merge${on}`;
    case 'on ramp': return `Take the ramp${on}`;
    case 'off ramp': return `Take the exit${on}`;
    case 'fork': return `Keep ${dir.includes('left') ? 'left' : dir.includes('right') ? 'right' : 'straight'} at the fork${on}`;
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return exit ? `At the roundabout, take the ${ORDINAL[exit - 1] ?? `${exit}th`} exit${on}` : `Enter the roundabout${on}`;
    case 'exit roundabout': case 'exit rotary': return `Leave the roundabout${on}`;
    default: return `${turn}${on}`;
  }
}

export function parseOsrm(routes: OsrmRoute[], profile: Profile, provider: string, waypoints?: { distance?: number }[]): Route[] {
  return routes.map((r, i): Route => {
    const steps = r.legs.flatMap((l) => l.steps).map((s): RouteStep => ({
      instruction: osrmInstruction(s), name: s.name ?? '', distance: s.distance, duration: s.duration,
      type: s.maneuver.type, modifier: s.maneuver.modifier ?? null,
      location: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
    }));
    return {
      id: `${provider}-${profile}-${i}`, profile, distance: r.distance, duration: r.duration,
      geometry: r.geometry.coordinates, steps, summary: r.legs.map((l) => l.summary).filter(Boolean).join(', '),
      trafficAware: false, durationTypical: null, provider,
      startGap: waypoints?.[0]?.distance, endGap: waypoints?.at(-1)?.distance,
    };
  });
}

const pair = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

export function osrmProvider(base: string): DirectionsProvider {
  // The FOSSGIS servers publish one service per profile. A self-hosted OSRM can follow the same layout.
  const service: Record<Profile, [string, string]> = { driving: ['routed-car', 'driving'], walking: ['routed-foot', 'foot'] };
  return {
    id: 'osrm',
    label: 'OSRM · OpenStreetMap',
    attribution: 'Routes: OSRM · © OpenStreetMap contributors',
    supportsTraffic: false,
    async route(req: RouteRequest) {
      const [srv, prof] = service[req.profile];
      const q = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true', alternatives: req.alternatives ? 'true' : 'false' });
      const { ok, body } = await fetchRouteJson(`${base}/${srv}/route/v1/${prof}/${pair(req.from)};${pair(req.to)}?${q}`, req.signal);
      if (body?.code === 'NoRoute' || body?.code === 'NoSegment') throw new RoutingError('no-route', body.code);
      if (!ok || body?.code !== 'Ok' || !Array.isArray(body.routes) || !body.routes.length) throw new RoutingError('bad-response', String(body?.code));
      return parseOsrm(body.routes, req.profile, 'osrm', body.waypoints);
    },
  };
}
