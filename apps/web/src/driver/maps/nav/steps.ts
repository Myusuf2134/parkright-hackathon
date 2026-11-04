/**
 * The maneuvers still ahead, in the provider's order, each with how far away it is from where the driver
 * is now. Only the provider's steps are used: nothing is merged, renamed or invented.
 */
import type { Route, RouteStep } from '../routing/types.ts';
import type { NavState } from './engine.ts';

export interface Upcoming {
  /** Index into route.steps, so a card can be followed as progress moves on. */
  index: number;
  step: RouteStep;
  /** Metres from the current position to this maneuver. */
  distance: number;
}

/**
 * Step i begins with its maneuver, and the driver is travelling along step `nav.stepIndex`, so the next
 * maneuver is the start of the following step, `toManeuver` metres away. Each later one is further by the
 * provider's length for the steps in between.
 */
export function upcomingSteps(route: Route, nav: Pick<NavState, 'stepIndex' | 'toManeuver'> | null): Upcoming[] {
  const steps = route.steps;
  if (!steps.length) return [];
  const current = nav?.stepIndex ?? 0;
  const first = Math.min(current + 1, steps.length - 1);
  let distance = nav ? nav.toManeuver : steps[current].distance;
  const out: Upcoming[] = [];
  for (let i = first; i < steps.length; i++) {
    if (i > first) distance += steps[i - 1].distance;
    out.push({ index: i, step: steps[i], distance });
  }
  return out;
}
