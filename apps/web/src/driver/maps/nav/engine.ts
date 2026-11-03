/**
 * Route progress from real GPS fixes. Pure: fix in, state out, so every rule is testable without a
 * browser. Nothing here moves the driver or estimates a position: if no fix arrives, nothing advances.
 */
import type { LatLng } from '../campus/types.ts';
import type { Route } from '../routing/types.ts';
import { bearing, metres, projectOnSegment, toLatLng } from './geo.ts';

export interface Fix extends LatLng {
  accuracy: number;
  heading: number | null;
  speed: number | null;
  at: number;
}

export interface PreparedRoute {
  route: Route;
  points: LatLng[];
  /** Metres along the polyline at each point. */
  along: number[];
  length: number;
  /** Metres along the polyline where each step ends, from the provider's step distances. */
  stepEnds: number[];
}

export function prepare(route: Route): PreparedRoute {
  const points = route.geometry.map(toLatLng);
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + metres(points[i - 1], points[i]));
  const length = along[along.length - 1] ?? 0;
  const total = route.steps.reduce((n, s) => n + s.distance, 0) || 1;
  let run = 0;
  const stepEnds = route.steps.map((s) => { run += s.distance; return (run / total) * length; });
  return { route, points, along, length, stepEnds };
}

export interface NavState {
  along: number;
  snapped: LatLng;
  /** Distance from the fix to the route. */
  offset: number;
  remaining: number;
  remainingSeconds: number;
  stepIndex: number;
  toManeuver: number;
  heading: number | null;
  /** Consecutive trustworthy fixes that were away from the route. */
  awayCount: number;
  offRoute: boolean;
  arrived: boolean;
  /** The last fix was too inaccurate to judge the route with. */
  weak: boolean;
  lastFixAt: number;
}

const WEAK_ACCURACY = 80;
const AWAY_FIXES = 3;

/** How far from the route a fix may be: wider for a poor fix, never beyond what GPS can excuse. */
export function offRouteThreshold(profile: Route['profile'], accuracy: number): number {
  return Math.max(profile === 'driving' ? 40 : 30, Math.min(accuracy * 1.25, WEAK_ACCURACY));
}

export function arrivalRadius(profile: Route['profile'], accuracy: number): number {
  return (profile === 'driving' ? 35 : 20) + Math.min(accuracy, 20);
}

function nearest(pr: PreparedRoute, p: LatLng, from: number, to: number) {
  let best = { along: 0, point: pr.points[0], distance: Number.POSITIVE_INFINITY, segment: 0 };
  for (let i = 0; i < pr.points.length - 1; i++) {
    if (pr.along[i + 1] < from || pr.along[i] > to) continue;
    const hit = projectOnSegment(p, pr.points[i], pr.points[i + 1]);
    if (hit.distance < best.distance) best = { along: pr.along[i] + (pr.along[i + 1] - pr.along[i]) * hit.t, point: hit.point, distance: hit.distance, segment: i };
  }
  return best;
}

function secondsLeft(pr: PreparedRoute, along: number, stepIndex: number): number {
  const steps = pr.route.steps;
  if (!steps.length || !pr.length) return pr.route.duration * Math.max(0, 1 - along / (pr.length || 1));
  const start = stepIndex === 0 ? 0 : pr.stepEnds[stepIndex - 1];
  const end = pr.stepEnds[stepIndex];
  const left = end > start ? Math.max(0, (end - along) / (end - start)) : 0;
  const stepSum = steps.reduce((n, s) => n + s.duration, 0) || 1;
  const scale = pr.route.duration / stepSum;
  let s = steps[stepIndex].duration * left;
  for (let i = stepIndex + 1; i < steps.length; i++) s += steps[i].duration;
  return s * scale;
}

export function advance(prev: NavState | null, pr: PreparedRoute, fix: Fix): NavState {
  const profile = pr.route.profile;
  const weak = fix.accuracy > WEAK_ACCURACY;
  // Search near the last position, so a route that doubles back doesn't jump to its other side.
  const lastAlong = prev?.along ?? 0;
  const elapsed = prev ? Math.max(1, (fix.at - prev.lastFixAt) / 1000) : 0;
  let hit = prev ? nearest(pr, fix, lastAlong - 40, lastAlong + Math.max(300, elapsed * 45)) : nearest(pr, fix, 0, pr.length);
  // Having left the window, a fix may rejoin further ahead (a shortcut), but never moves back.
  if (prev && hit.distance > offRouteThreshold(profile, fix.accuracy)) {
    const ahead = nearest(pr, fix, lastAlong, pr.length);
    if (ahead.distance < hit.distance) hit = ahead;
  }
  const away = hit.distance > offRouteThreshold(profile, fix.accuracy);
  const moved = weak || away ? lastAlong : Math.max(lastAlong - 5, hit.along);
  const along = Math.min(pr.length, moved);
  let stepIndex = pr.stepEnds.findIndex((e) => along < e - 1);
  if (stepIndex < 0) stepIndex = Math.max(0, pr.route.steps.length - 1);
  const awayCount = weak ? prev?.awayCount ?? 0 : away ? (prev?.awayCount ?? 0) + 1 : 0;
  const end = pr.points[pr.points.length - 1] ?? fix;
  const toEnd = metres(fix, end);
  const remaining = Math.max(0, pr.length - along);
  const radius = arrivalRadius(profile, fix.accuracy);
  const arrived = !!prev?.arrived || (!weak && toEnd <= radius && (remaining <= radius * 2 || pr.length <= radius * 2));
  const heading = fix.heading !== null && Number.isFinite(fix.heading) && (fix.speed ?? 0) > 1
    ? fix.heading
    : hit.segment < pr.points.length - 1 ? bearing(pr.points[hit.segment], pr.points[hit.segment + 1]) : prev?.heading ?? null;
  return {
    along, snapped: away ? { lat: fix.lat, lng: fix.lng } : hit.point, offset: hit.distance, remaining,
    remainingSeconds: secondsLeft(pr, along, stepIndex),
    stepIndex, toManeuver: Math.max(0, (pr.stepEnds[stepIndex] ?? pr.length) - along), heading,
    awayCount, offRoute: awayCount >= AWAY_FIXES && !arrived, arrived, weak, lastFixAt: fix.at,
  };
}

/** The part of the route still ahead, for drawing. */
export function remainingGeometry(pr: PreparedRoute, state: NavState): [number, number][] {
  const rest = pr.route.geometry.filter((_, i) => pr.along[i] > state.along);
  return [[state.snapped.lng, state.snapped.lat], ...rest];
}

/** Whether a reroute may be sent now. */
export const canReroute = (state: NavState, lastAttemptAt: number, now: number, cooldownMs = 12_000) => state.offRoute && now - lastAttemptAt >= cooldownMs;
