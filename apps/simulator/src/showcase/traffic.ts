/**
 * Deterministic showcase traffic: scripted routes on a one-way circulation loop and a seeded
 * event scheduler. Pure TypeScript (no three.js, no DOM, no clock): everything at sim time t
 * is a function of (scenario, seed, t).
 *
 *   entrance (west) → aisle 1 eastbound → east turnaround → aisle 2 westbound → exit (west)
 *
 * A/B bays are entered from aisle 1, C/D bays from aisle 2. Departures reverse out (or drive out,
 * when the car had reversed in) and follow the loop to the exit. Pass-through vehicles drive the
 * whole loop without parking. The scheduler runs a small simulation of bay reservations up front
 * for 30 minutes of sim time, so no two vehicles target the same bay and entries are spaced out.
 */
import type { GarageVehiclePose, Leg, XZ } from '../garage/scenarios.ts';
import type { VehicleKind } from '../sim/vehicles.ts';
import { SHOWCASE, SHOWCASE_BAYS, type ShowcaseBay } from './layout.ts';
import {
  buildSiteSchedule, bayPoints, HORIZON_MS, isShowcaseScenario, occupiedIn, OCCUPIED_COVERAGE, posesAt, quad,
  type Schedule, type ScheduleEvent, type ShowcaseScenarioId, type ShowcaseVehicle, type SiteBay, type TrafficSite,
} from './schedule.ts';

export type { GarageVehiclePose as VehiclePose, XZ };
export { HORIZON_MS, isShowcaseScenario, OCCUPIED_COVERAGE, posesAt };
export type { Schedule, ScheduleEvent, ShowcaseScenarioId, ShowcaseVehicle };

export const SHOWCASE_SCENARIOS = {
  live: { title: 'Live garage', initial: 18, gap: [5, 9], weights: { arrive: 0.45, depart: 0.4, pass: 0.15 } },
  'morning-rush': { title: 'Morning rush', initial: 6, gap: [3, 5], weights: { arrive: 0.8, depart: 0.1, pass: 0.1 } },
  'class-transition': { title: 'Class transition', initial: 26, gap: [3, 5], weights: { arrive: 0.5, depart: 0.5, pass: 0 } },
  'nearly-full': { title: 'Nearly full', initial: 31, gap: [6, 10], weights: { arrive: 0.4, depart: 0.45, pass: 0.15 } },
  sparse: { title: 'Sparse', initial: 5, gap: [8, 12], weights: { arrive: 0.35, depart: 0.35, pass: 0.3 } },
  entering: { title: 'Entering vehicles', initial: 10, gap: [4, 6], weights: { arrive: 1, depart: 0, pass: 0 } },
  exiting: { title: 'Exiting vehicles', initial: 30, gap: [4, 6], weights: { arrive: 0, depart: 1, pass: 0 } },
  'occlusion-stress': { title: 'Occlusion stress', initial: 18, gap: [3, 5], weights: { arrive: 0.2, depart: 0.2, pass: 0.6 } },
  'pass-through': { title: 'Pass-through traffic', initial: 16, gap: [4, 7], weights: { arrive: 0, depart: 0, pass: 1 } },
  validation: { title: 'Static validation scene', initial: 0, gap: [0, 0], weights: { arrive: 0, depart: 0, pass: 0 } },
} as const satisfies TrafficSite['scenarios'];

export const SHOWCASE_SCENARIO_IDS = Object.keys(SHOWCASE_SCENARIOS) as ShowcaseScenarioId[];

/** The recording/validation scene: every row has occupied bays next to empty ones, including the
 * large vehicles that caused the 12-space garage's B5 → B6 spill. */
export const VALIDATION_PARKED: Record<string, VehicleKind> = {
  A1: 'sedan', A3: 'suv', A4: 'van', A7: 'pickup', A9: 'hatchback',
  B2: 'suv', B5: 'pickup', B7: 'sedan',
  C1: 'van', C3: 'sedan', C4: 'suv', C8: 'hatchback',
  D2: 'pickup', D5: 'sedan', D6: 'suv', D9: 'van',
};

const CRUISE = 4.0;
const TURN = 2.2;
const REVERSE = 1.3;
const OUT_W = SHOWCASE.entranceX - 3;
const L1 = SHOWCASE.aisle1.lane;
const L2 = SHOWCASE.aisle2.lane;
const LX = SHOWCASE.loopX;

/** The loop from the entrance along aisle 1, round the east end, and along aisle 2 to x = untilX. */
function loopTo(untilX: number): XZ[] {
  return [
    [OUT_W, L1], [LX - 3, L1], ...quad([LX - 3, L1], [LX, L1], [LX, L1 + 3]),
    [LX, L2 - 3], ...quad([LX, L2 - 3], [LX, L2], [LX - 3, L2]), [untilX, L2],
  ];
}
/** From a point on aisle 1 heading east, the rest of the loop to the exit. */
function aisle1ToExit(fromX: number): XZ[] {
  return [[fromX, L1], [LX - 3, L1], ...quad([LX - 3, L1], [LX, L1], [LX, L1 + 3]), [LX, L2 - 3], ...quad([LX, L2 - 3], [LX, L2], [LX - 3, L2]), [OUT_W, L2]];
}

const usesAisle1 = (b: SiteBay) => b.row === 'A' || b.row === 'B';
const lane = (b: SiteBay) => (usesAisle1(b) ? L1 : L2);
export function arrivalLegs(b: SiteBay): Leg[] {
  const [bx] = b.centre;
  const { inside, mouth } = bayPoints(b);
  const l = lane(b);
  // Aisle 1 runs east (approach from the west); aisle 2 runs west (approach from the east).
  const turnStart: XZ = usesAisle1(b) ? [bx - 4.6, l] : [bx + 4.6, l];
  const drive = usesAisle1(b) ? [[OUT_W, L1], turnStart] as XZ[] : loopTo(turnStart[0]);
  return [
    { points: drive, speed: CRUISE },
    { points: [turnStart, ...quad(turnStart, [bx, l], mouth), inside], speed: TURN },
  ];
}

export function departureLegs(b: SiteBay, from: XZ, noseIn: boolean): Leg[] {
  const [bx] = b.centre;
  const { mouth } = bayPoints(b);
  const l = lane(b);
  const east = usesAisle1(b); // aisle 1 leaves eastbound, aisle 2 westbound
  const swing: XZ = east ? [bx - 3.6, l] : [bx + 3.6, l];
  const out: Leg = noseIn
    // Reverse out, swinging the rear against the direction of travel, so the nose ends up pointing along the lane.
    ? { points: [from, mouth, ...quad(mouth, [bx, l], swing)], speed: REVERSE, reverse: true, holdMs: 500 }
    // Reversed in: drive straight out and turn into the lane.
    : { points: [from, mouth, ...quad(mouth, [bx, l], east ? [bx + 3.6, l] : [bx - 3.6, l])], speed: TURN };
  const start = noseIn ? swing : east ? ([bx + 3.6, l] as XZ) : ([bx - 3.6, l] as XZ);
  const rest: XZ[] = east ? aisle1ToExit(start[0]) : [start, [OUT_W, L2]];
  return [out, { points: rest, speed: CRUISE }];
}

export function passLegs(): Leg[] {
  return [{ points: loopTo(OUT_W), speed: CRUISE }];
}

/** The 34-space garage as a traffic site. Its rng namespace and routes are unchanged, so every
 * 34-space schedule is identical to the one before sites existed. */
export const SHOWCASE_TRAFFIC: TrafficSite = {
  rngLabel: 'showcase',
  bays: SHOWCASE_BAYS,
  scenarios: SHOWCASE_SCENARIOS,
  validationParked: VALIDATION_PARKED,
  arrivalLegs,
  departureLegs,
  passLegs: () => passLegs(),
};

/** The full deterministic 34-space schedule for a scenario (cached). */
export function buildSchedule(scenario: ShowcaseScenarioId, seed = 4242): Schedule {
  return buildSiteSchedule(SHOWCASE_TRAFFIC, scenario, seed);
}

/** 34-space bays physically occupied (vehicle footprints cover >= 30% of the bay). Ground truth only. */
export function occupiedAt(poses: readonly GarageVehiclePose[]): string[] {
  return occupiedIn(SHOWCASE_BAYS, poses);
}

export type { ShowcaseBay, Leg };
