import { mapboxProvider } from './mapbox.ts';
import { osrmProvider } from './osrm.ts';
import { polite } from './polite.ts';
import type { DirectionsProvider } from './types.ts';

export * from './types.ts';

/** A Mapbox token turns on traffic-aware routing. Without one, Meridian uses OSRM and says traffic isn't included. */
export function createProvider(env: Record<string, string | undefined> = import.meta.env): DirectionsProvider {
  const token = env.VITE_MAPBOX_TOKEN;
  return polite(token ? mapboxProvider(token) : osrmProvider(env.VITE_OSRM_BASE ?? 'https://routing.openstreetmap.de'));
}
