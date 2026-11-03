/**
 * Mapbox Directions v5, with the driving-traffic profile: the one provider here whose driving times
 * include live traffic. Needs a public (pk.) token, restricted to Meridian's URLs in the Mapbox account.
 */
import type { LatLng } from '../campus/types.ts';
import { fetchRouteJson } from './fetch.ts';
import { RoutingError, type DirectionsProvider, type Profile, type Route, type RouteRequest } from './types.ts';

interface MbStep {
  distance: number; duration: number; name?: string;
  maneuver: { type: string; modifier?: string; instruction: string; location: [number, number] };
}
interface MbRoute { distance: number; duration: number; duration_typical?: number; geometry: { coordinates: [number, number][] }; legs: { summary?: string; steps: MbStep[] }[] }

export function parseMapbox(routes: MbRoute[], profile: Profile, waypoints?: { distance?: number }[]): Route[] {
  return routes.map((r, i): Route => ({
    id: `mapbox-${profile}-${i}`, profile, distance: r.distance, duration: r.duration,
    geometry: r.geometry.coordinates,
    steps: r.legs.flatMap((l) => l.steps).map((s) => ({
      instruction: s.maneuver.instruction, name: s.name ?? '', distance: s.distance, duration: s.duration,
      type: s.maneuver.type, modifier: s.maneuver.modifier ?? null,
      location: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
    })),
    summary: r.legs.map((l) => l.summary).filter(Boolean).join(', '),
    trafficAware: profile === 'driving',
    durationTypical: r.duration_typical ?? null,
    provider: 'mapbox',
    startGap: waypoints?.[0]?.distance,
    endGap: waypoints?.at(-1)?.distance,
  }));
}

const pair = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

export function mapboxProvider(token: string, base = 'https://api.mapbox.com'): DirectionsProvider {
  return {
    id: 'mapbox',
    label: 'Mapbox',
    attribution: 'Routes and traffic: © Mapbox',
    supportsTraffic: true,
    async route(req: RouteRequest) {
      const profile = req.profile === 'driving' ? 'driving-traffic' : 'walking';
      const q = new URLSearchParams({ access_token: token, overview: 'full', geometries: 'geojson', steps: 'true', alternatives: req.alternatives ? 'true' : 'false' });
      const { ok, body } = await fetchRouteJson(`${base}/directions/v5/mapbox/${profile}/${pair(req.from)};${pair(req.to)}?${q}`, req.signal);
      if (body?.code === 'NoRoute' || body?.code === 'NoSegment') throw new RoutingError('no-route', body.code);
      if (!ok || body?.code !== 'Ok' || !Array.isArray(body.routes) || !body.routes.length) throw new RoutingError('bad-response', String(body?.code ?? body?.message));
      return parseMapbox(body.routes, req.profile, body.waypoints);
    },
  };
}
