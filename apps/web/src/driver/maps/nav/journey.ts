/**
 * The whole trip as one state machine: preview routes, choose one, drive to the garage's entrance, park,
 * walk to the destination. Pure, with the side effects (requests, GPS) in useJourney.
 */
import type { LatLng } from '../campus/types.ts';
import type { Route, RoutingFailure } from '../routing/types.ts';
import type { PlanPoint } from './plan.ts';

export type TravelMode = 'drive' | 'walk';

export interface JourneyGarage extends LatLng {
  id: string; name: string; hasEntrance: boolean;
  /** Where a car can be sent, and where someone on foot can leave. */
  drive: PlanPoint[];
  walkFrom: (toward: LatLng) => PlanPoint[];
}
export interface JourneyPlace extends LatLng {
  name: string;
  walkTo: (from: LatLng) => PlanPoint[];
}

/** The ends the routes actually use. */
export interface LegEnds { driveTo: PlanPoint | null; walkFrom: PlanPoint | null; walkTo: PlanPoint | null }
export const NO_ENDS: LegEnds = { driveTo: null, walkFrom: null, walkTo: null };

export interface JourneyTarget {
  garage: JourneyGarage | null;
  destination: JourneyPlace | null;
}

export type Load =
  | { state: 'loading' }
  | { state: 'ok' }
  | { state: 'error'; kind: RoutingFailure }
  | { state: 'no-origin' };

export type Journey =
  | { phase: 'idle' }
  | { phase: 'preview'; target: JourneyTarget; mode: TravelMode; routes: Route[]; selected: number; walkLeg: Route | null; load: Load; walkLegFailed: boolean; ends: LegEnds }
  | { phase: 'navigating'; target: JourneyTarget; leg: TravelMode; route: Route; walkLeg: Route | null; ends: LegEnds; reroutes: number; rerouting: boolean; rerouteFailed: boolean }
  | { phase: 'at-garage'; target: JourneyTarget; walkLeg: Route | null; ends: LegEnds; loadingWalk: boolean; walkFailed: boolean }
  | { phase: 'arrived'; target: JourneyTarget };

export type JourneyAction =
  | { type: 'open'; target: JourneyTarget; mode: TravelMode }
  | { type: 'mode'; mode: TravelMode }
  | { type: 'loading' }
  | { type: 'no-origin' }
  | { type: 'routes'; routes: Route[]; walkLeg: Route | null; walkLegFailed: boolean; ends: LegEnds }
  | { type: 'routes-failed'; kind: RoutingFailure }
  | { type: 'select'; index: number }
  | { type: 'start' }
  | { type: 'reroute-start' }
  | { type: 'reroute-done'; route: Route }
  | { type: 'reroute-failed' }
  | { type: 'reached' }
  | { type: 'walk-loading' }
  | { type: 'walk-failed' }
  | { type: 'start-walk'; route: Route }
  | { type: 'close' };

export const JOURNEY_IDLE: Journey = { phase: 'idle' };

export function journeyReducer(s: Journey, a: JourneyAction): Journey {
  switch (a.type) {
    case 'open':
      return { phase: 'preview', target: a.target, mode: a.mode, routes: [], selected: 0, walkLeg: null, load: { state: 'loading' }, walkLegFailed: false, ends: NO_ENDS };
    case 'close':
      return JOURNEY_IDLE;
    case 'mode':
      return s.phase === 'preview' && s.mode !== a.mode ? { ...s, mode: a.mode, routes: [], selected: 0, walkLeg: null, load: { state: 'loading' }, walkLegFailed: false, ends: NO_ENDS } : s;
    case 'loading':
      return s.phase === 'preview' ? { ...s, load: { state: 'loading' } } : s;
    case 'no-origin':
      return s.phase === 'preview' ? { ...s, routes: [], walkLeg: null, load: { state: 'no-origin' } } : s;
    case 'routes':
      return s.phase === 'preview' ? { ...s, routes: a.routes, selected: 0, walkLeg: a.walkLeg, walkLegFailed: a.walkLegFailed, ends: a.ends, load: { state: 'ok' } } : s;
    case 'routes-failed':
      return s.phase === 'preview' ? { ...s, routes: [], walkLeg: null, load: { state: 'error', kind: a.kind } } : s;
    case 'select':
      return s.phase === 'preview' && a.index >= 0 && a.index < s.routes.length ? { ...s, selected: a.index } : s;
    case 'start':
      return s.phase === 'preview' && s.routes[s.selected]
        ? { phase: 'navigating', target: s.target, leg: s.mode, route: s.routes[s.selected], walkLeg: s.walkLeg, ends: s.ends, reroutes: 0, rerouting: false, rerouteFailed: false }
        : s;
    case 'reroute-start':
      return s.phase === 'navigating' ? { ...s, rerouting: true, rerouteFailed: false } : s;
    case 'reroute-done':
      return s.phase === 'navigating' ? { ...s, route: a.route, rerouting: false, rerouteFailed: false, reroutes: s.reroutes + 1 } : s;
    case 'reroute-failed':
      return s.phase === 'navigating' ? { ...s, rerouting: false, rerouteFailed: true } : s;
    case 'reached':
      if (s.phase !== 'navigating') return s;
      // Reaching the garage by car leads on to the walk, if there's somewhere to walk to.
      return s.leg === 'drive' && s.target.destination
        ? { phase: 'at-garage', target: s.target, walkLeg: s.walkLeg, ends: s.ends, loadingWalk: false, walkFailed: false }
        : { phase: 'arrived', target: s.target };
    case 'walk-loading':
      return s.phase === 'at-garage' ? { ...s, loadingWalk: true, walkFailed: false } : s;
    case 'walk-failed':
      return s.phase === 'at-garage' ? { ...s, loadingWalk: false, walkFailed: true } : s;
    case 'start-walk':
      return s.phase === 'at-garage'
        ? { phase: 'navigating', target: s.target, leg: 'walk', route: a.route, walkLeg: null, ends: s.ends, reroutes: 0, rerouting: false, rerouteFailed: false }
        : s;
  }
}

/** Where this leg's route ends now: the door or entrance the plan settled on. */
export function legEnd(target: JourneyTarget, mode: TravelMode, ends: LegEnds): LatLng | null {
  return mode === 'drive' ? ends.driveTo ?? target.garage ?? target.destination : ends.walkTo ?? target.destination ?? target.garage;
}
