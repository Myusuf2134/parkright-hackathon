/**
 * Deterministic traffic for the Ohio Union North Garage-inspired simulation. Pure TypeScript:
 * routes on this deck's one-way circulation, scenario sizes for 72 bays and the static
 * validation scene. The scheduler itself is shared with the 34-space showcase (showcase/schedule.ts).
 *
 *   entrance (west) → aisle 1 eastbound ─┬─ spine (southbound shortcut) ─┐
 *                                        └─ east turnaround (southbound) ┴→ aisle 2 westbound → exit (west)
 *                                        └─ ramp up to level 2 (east bay)
 *   ramp down from level 2 → east turnaround → aisle 2 westbound → exit
 *
 * A/B bays are entered from aisle 1, C/D bays from aisle 2 (west-module C/D bays through the spine,
 * east-module C/D bays round the east turnaround). Pass-through traffic takes one of four routes:
 * the full loop, the spine, up the ramp, or down the ramp and out. Cars on the ramp, in the spine
 * and in the aisles drive in front of the cameras: the occlusion the 34-space garage lacked.
 */
import type { Leg, XZ } from '../garage/scenarios.ts';
import { bayPoints, quad, type Rng, type ShowcaseScenarioId, type SiteBay, type TrafficSite } from '../showcase/schedule.ts';
import type { VehicleKind } from '../sim/vehicles.ts';
import { OHIO, OHIO_BAYS } from './layout.ts';

export const OHIO_SCENARIOS: TrafficSite['scenarios'] = {
  live: { title: 'Live garage', initial: 38, gap: [3, 6], weights: { arrive: 0.42, depart: 0.38, pass: 0.2 } },
  'morning-rush': { title: 'Morning rush (8–9 am)', initial: 12, gap: [2.5, 4], weights: { arrive: 0.8, depart: 0.08, pass: 0.12 } },
  'class-transition': { title: 'Class transition', initial: 54, gap: [2.5, 4], weights: { arrive: 0.5, depart: 0.5, pass: 0 } },
  'nearly-full': { title: 'Nearly full (event day)', initial: 66, gap: [5, 8], weights: { arrive: 0.4, depart: 0.45, pass: 0.15 } },
  sparse: { title: 'Sparse (evening)', initial: 10, gap: [7, 11], weights: { arrive: 0.35, depart: 0.35, pass: 0.3 } },
  entering: { title: 'Entering vehicles', initial: 20, gap: [3.5, 5], weights: { arrive: 1, depart: 0, pass: 0 } },
  exiting: { title: 'Exiting vehicles', initial: 64, gap: [3.5, 5], weights: { arrive: 0, depart: 1, pass: 0 } },
  'occlusion-stress': { title: 'Occlusion stress (vans, ramp traffic)', initial: 38, gap: [2.5, 4], weights: { arrive: 0.2, depart: 0.2, pass: 0.6 } },
  'pass-through': { title: 'Pass-through and ramp traffic', initial: 34, gap: [3, 6], weights: { arrive: 0, depart: 0, pass: 1 } },
  validation: { title: 'Static validation scene', initial: 0, gap: [0, 0], weights: { arrive: 0, depart: 0, pass: 0 } },
};

export const OHIO_SCENARIO_IDS = Object.keys(OHIO_SCENARIOS) as ShowcaseScenarioId[];

/** The validation scene: in every half-row, occupied bays next to empty ones, including large
 * vehicles beside empty bays (the 12-space garage's B5 → B6 spill case, twice per row). */
export const OHIO_VALIDATION_PARKED: Record<string, VehicleKind> = {
  A1: 'sedan', A3: 'suv', A4: 'van', A7: 'pickup', A9: 'hatchback', A10: 'suv', A12: 'pickup', A13: 'sedan', A16: 'van', A18: 'sedan',
  B2: 'suv', B5: 'pickup', B7: 'sedan', B9: 'van', B10: 'hatchback', B11: 'suv', B14: 'pickup', B17: 'sedan',
  C1: 'van', C3: 'sedan', C4: 'suv', C8: 'hatchback', C11: 'pickup', C12: 'sedan', C15: 'van', C18: 'suv',
  D2: 'pickup', D5: 'sedan', D6: 'suv', D9: 'van', D10: 'sedan', D13: 'suv', D14: 'van', D17: 'pickup',
};

const CRUISE = 4.0;
const TURN = 2.2;
const REVERSE = 1.3;
const RAMP = 3.2;
const OUT_W = OHIO.westWallX - 4;
const L1 = OHIO.aisle1.lane;
const L2 = OHIO.aisle2.lane;
const SX = OHIO.spine.lane;
const LX = OHIO.loop.lane;
const R = OHIO.ramp;

/** Aisle 1 at x = fromX → down the spine → aisle 2 westbound, ending at x = untilX (< SX − 3). */
function viaSpine(fromX: number, untilX: number): XZ[] {
  return [[fromX, L1], [SX - 3, L1], ...quad([SX - 3, L1], [SX, L1], [SX, L1 + 3]), [SX, L2 - 3], ...quad([SX, L2 - 3], [SX, L2], [SX - 3, L2]), [untilX, L2]];
}
/** Aisle 1 at x = fromX → east turnaround → aisle 2 westbound, ending at x = untilX. */
function viaLoop(fromX: number, untilX: number): XZ[] {
  return [[fromX, L1], [LX - 3, L1], ...quad([LX - 3, L1], [LX, L1], [LX, L1 + 3]), [LX, L2 - 3], ...quad([LX, L2 - 3], [LX, L2], [LX - 3, L2]), [untilX, L2]];
}
/** Aisle 1 at x = fromX → past the turnaround → up the ramp's up lane to level 2. */
function upRamp(fromX: number): XZ[] {
  return [[fromX, L1], [R.upLane - 3.2, L1], ...quad([R.upLane - 3.2, L1], [R.upLane, L1], [R.upLane, R.z0 + 0.5]), [R.upLane, R.z1 + 1.5]];
}
/** Down the ramp's down lane from level 2, round the east end into the turnaround, aisle 2 to the exit. */
function downRamp(): XZ[] {
  const north = 7.4;
  return [
    [R.downLane, R.z1 + 1.5], [R.downLane, R.z0 + 0.5], ...quad([R.downLane, R.z0 + 0.5], [R.downLane, north], [R.downLane - 3.4, north]),
    ...quad([R.downLane - 3.4, north], [LX, north], [LX, north + 4.4]), [LX, L2 - 3], ...quad([LX, L2 - 3], [LX, L2], [LX - 3, L2]), [OUT_W, L2],
  ];
}

const usesAisle1 = (b: SiteBay) => b.row === 'A' || b.row === 'B';
const lane = (b: SiteBay) => (usesAisle1(b) ? L1 : L2);
/** West-module aisle-2 bays reached through the spine (their turn starts west of the spine's exit curve). */
const spineReach = (x: number) => x <= SX - 3;

export function ohioArrivalLegs(b: SiteBay): Leg[] {
  const [bx] = b.centre;
  const { inside, mouth } = bayPoints(b);
  const l = lane(b);
  // Aisle 1 runs east (approach from the west); aisle 2 runs west (approach from the east).
  const turnStart: XZ = usesAisle1(b) ? [bx - 4.6, l] : [bx + 4.6, l];
  const drive: XZ[] = usesAisle1(b) ? [[OUT_W, L1], turnStart] : spineReach(turnStart[0]) ? viaSpine(OUT_W, turnStart[0]) : viaLoop(OUT_W, turnStart[0]);
  return [
    { points: drive, speed: CRUISE },
    { points: [turnStart, ...quad(turnStart, [bx, l], mouth), inside], speed: TURN },
  ];
}

export function ohioDepartureLegs(b: SiteBay, from: XZ, noseIn: boolean): Leg[] {
  const [bx] = b.centre;
  const { mouth } = bayPoints(b);
  const l = lane(b);
  const east = usesAisle1(b); // aisle 1 leaves eastbound, aisle 2 westbound
  const swing: XZ = east ? [bx - 3.6, l] : [bx + 3.6, l];
  const out: Leg = noseIn
    ? { points: [from, mouth, ...quad(mouth, [bx, l], swing)], speed: REVERSE, reverse: true, holdMs: 500 }
    : { points: [from, mouth, ...quad(mouth, [bx, l], east ? [bx + 3.6, l] : [bx - 3.6, l])], speed: TURN };
  const start: XZ = noseIn ? swing : east ? [bx + 3.6, l] : [bx - 3.6, l];
  const rest: XZ[] = !east ? [start, [OUT_W, L2]] : start[0] < SX - 3 ? viaSpine(start[0], OUT_W) : viaLoop(start[0], OUT_W);
  return [out, { points: rest, speed: CRUISE }];
}

export type PassRoute = 'loop' | 'spine' | 'up' | 'down';
export function ohioPassLegs(route: PassRoute): Leg[] {
  if (route === 'spine') return [{ points: viaSpine(OUT_W, OUT_W), speed: CRUISE }];
  if (route === 'up') return [{ points: upRamp(OUT_W).slice(0, -1), speed: CRUISE }, { points: upRamp(OUT_W).slice(-2), speed: RAMP }];
  if (route === 'down') {
    const p = downRamp();
    return [{ points: p.slice(0, 2), speed: RAMP }, { points: p.slice(1), speed: CRUISE }];
  }
  return [{ points: viaLoop(OUT_W, OUT_W), speed: CRUISE }];
}

export const OHIO_TRAFFIC: TrafficSite = {
  rngLabel: 'ohio-union',
  bays: OHIO_BAYS,
  scenarios: OHIO_SCENARIOS,
  validationParked: OHIO_VALIDATION_PARKED,
  arrivalLegs: ohioArrivalLegs,
  departureLegs: ohioDepartureLegs,
  passLegs: (r: Rng) => ohioPassLegs(r.weighted([['loop', 0.35], ['spine', 0.25], ['up', 0.22], ['down', 0.18]] as const)),
};
