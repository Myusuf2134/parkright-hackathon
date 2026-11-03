/** What Meridian needs from any directions service. Everything shown about a route comes through here. */
import type { LatLng } from '../campus/types.ts';

export type Profile = 'driving' | 'walking';

export interface RouteStep {
  /** Provider's instruction, or built only from the provider's maneuver data. */
  instruction: string;
  name: string;
  distance: number;
  duration: number;
  type: string;
  modifier: string | null;
  location: LatLng;
}

export interface Route {
  id: string;
  profile: Profile;
  /** Metres and seconds, as the provider returned them. */
  distance: number;
  duration: number;
  /** [lng, lat] pairs. */
  geometry: [number, number][];
  steps: RouteStep[];
  summary: string;
  /** True only when the provider's duration reflects current traffic. */
  trafficAware: boolean;
  /** The same trip without current traffic, when the provider gives it. */
  durationTypical: number | null;
  provider: string;
  /** How far the provider had to move each requested end to reach its road or path network, in metres. */
  startGap?: number;
  endGap?: number;
}

export interface RouteRequest {
  profile: Profile;
  from: LatLng;
  to: LatLng;
  alternatives?: boolean;
  signal?: AbortSignal;
}

export type RoutingFailure = 'network' | 'no-route' | 'rate-limit' | 'auth' | 'bad-response' | 'aborted' | 'too-close';

export class RoutingError extends Error {
  constructor(public kind: RoutingFailure, message: string) { super(message); this.name = 'RoutingError'; }
}

export interface DirectionsProvider {
  id: string;
  label: string;
  attribution: string;
  /** Whether driving durations can include live traffic. */
  supportsTraffic: boolean;
  route(req: RouteRequest): Promise<Route[]>;
}

export const failureText = (kind: RoutingFailure): string => ({
  network: "Can't reach the directions service. Check your connection and try again.",
  'no-route': 'No route found between these points.',
  'rate-limit': 'The directions service is busy. Try again in a moment.',
  auth: "The directions service rejected Meridian's key.",
  'bad-response': 'The directions service sent a response Meridian could not read.',
  aborted: 'Cancelled.',
  'too-close': "You're already there: the start and the end are the same point on the road network.",
}[kind]);
