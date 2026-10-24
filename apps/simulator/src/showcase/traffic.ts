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
import { bayCoverage, footprint, type GarageVehiclePose, type Leg, type ScriptedVehicle, scriptedPose, routeEndMs, type XZ } from '../garage/scenarios.ts';
import { rng } from '../sim/prng.ts';
import { generateVehicle, type VehicleKind, type VehicleSpec } from '../sim/vehicles.ts';
import { SHOWCASE, SHOWCASE_BAYS, showcaseBay, type ShowcaseBay } from './layout.ts';

export type { GarageVehiclePose as VehiclePose, XZ };

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
} as const;

export type ShowcaseScenarioId = keyof typeof SHOWCASE_SCENARIOS;
export const SHOWCASE_SCENARIO_IDS = Object.keys(SHOWCASE_SCENARIOS) as ShowcaseScenarioId[];
export const isShowcaseScenario = (v: string): v is ShowcaseScenarioId => v in SHOWCASE_SCENARIOS;

/** The recording/validation scene: every row has occupied bays next to empty ones, including the
 * large vehicles that caused the 12-space garage's B5 → B6 spill. */
export const VALIDATION_PARKED: Record<string, VehicleKind> = {
  A1: 'sedan', A3: 'suv', A4: 'van', A7: 'pickup', A9: 'hatchback',
  B2: 'suv', B5: 'pickup', B7: 'sedan',
  C1: 'van', C3: 'sedan', C4: 'suv', C8: 'hatchback',
  D2: 'pickup', D5: 'sedan', D6: 'suv', D9: 'van',
};

export const HORIZON_MS = 30 * 60 * 1000;
const CRUISE = 4.0;
const TURN = 2.2;
const REVERSE = 1.3;
const OUT_W = SHOWCASE.entranceX - 3;
const L1 = SHOWCASE.aisle1.lane;
const L2 = SHOWCASE.aisle2.lane;
const LX = SHOWCASE.loopX;

const SAMPLES = 14;
function quad(a: XZ, c: XZ, b: XZ): XZ[] {
  const out: XZ[] = [];
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    out.push([+(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]).toFixed(4), +(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]).toFixed(4)]);
  }
  return out;
}

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

const usesAisle1 = (b: ShowcaseBay) => b.row === 'A' || b.row === 'B';
const lane = (b: ShowcaseBay) => (usesAisle1(b) ? L1 : L2);
/** Inside point (where the car stops) and mouth (where it enters the bay). */
function bayPoints(b: ShowcaseBay): { inside: XZ; mouth: XZ } {
  const [bx, bz] = b.centre;
  const deeper = -b.opensTo * 0.3;
  const mouthZ = b.opensTo === 1 ? b.corners[2][2] - 0.6 : b.corners[0][2] + 0.6;
  return { inside: [bx, +(bz + deeper).toFixed(3)], mouth: [bx, +mouthZ.toFixed(3)] };
}

export function arrivalLegs(b: ShowcaseBay): Leg[] {
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

export function departureLegs(b: ShowcaseBay, from: XZ, noseIn: boolean): Leg[] {
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

// ---- vehicles and schedule -----------------------------------------------------------------

export interface ShowcaseVehicle {
  id: string;
  spec: VehicleSpec;
  bay: string | null;
  /** Parked from the start of the scenario (no arrival route). */
  initial: boolean;
  noseIn: boolean;
  arrival: ScriptedVehicle | null;
  departure: ScriptedVehicle | null;
  pass: ScriptedVehicle | null;
}

export interface ScheduleEvent {
  t: number;
  kind: 'arrive' | 'depart' | 'pass';
  vehicle: string;
  bay: string | null;
}

export interface Schedule {
  scenario: ShowcaseScenarioId;
  seed: number;
  vehicles: ShowcaseVehicle[];
  events: ScheduleEvent[];
  initialOccupied: string[];
}

const DIMENSIONS: Record<VehicleKind, [number, number, number]> = {
  sedan: [4.7, 1.82, 1.45], hatchback: [4.15, 1.76, 1.5], suv: [4.85, 1.95, 1.75], pickup: [5.35, 1.98, 1.85], van: [5.05, 2.0, 2.15],
};
function specOf(seed: number, key: string, kind?: VehicleKind): VehicleSpec {
  const base = generateVehicle(seed, key, 0);
  if (!kind) return base;
  const [length, width, height] = DIMENSIONS[kind];
  return { ...base, kind, length, width, height };
}

function parkedPoint(b: ShowcaseBay, spec: VehicleSpec): XZ {
  const { inside } = bayPoints(b);
  return [+(inside[0] + spec.offsetX * 0.6).toFixed(4), +(inside[1] + spec.offsetZ * 0.3).toFixed(4)];
}
function parkedHeading(b: ShowcaseBay, noseIn: boolean, spec: VehicleSpec): number {
  const base = b.opensTo === 1 ? Math.PI : 0; // nose-in faces away from the aisle
  return +((noseIn ? base : base + Math.PI) + spec.yaw).toFixed(6);
}

const cache = new Map<string, Schedule>();

/** The full deterministic schedule for a scenario (cached). */
export function buildSchedule(scenario: ShowcaseScenarioId, seed = 4242): Schedule {
  const key = `${scenario}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cfg = SHOWCASE_SCENARIOS[scenario];
  const r = rng(seed, 'showcase', scenario);
  const vehicles: ShowcaseVehicle[] = [];
  const events: ScheduleEvent[] = [];

  // Initial parked set: a seeded shuffle of the bays (the validation scene is fixed).
  const order = [...SHOWCASE_BAYS.map((b) => b.id)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = r.int(0, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const initial = scenario === 'validation' ? Object.keys(VALIDATION_PARKED) : order.slice(0, cfg.initial);
  /** bay → vehicle parked (or arriving) there, with the time it becomes free again. */
  const holder = new Map<string, ShowcaseVehicle>();
  for (const bay of initial) {
    const v: ShowcaseVehicle = {
      id: `p-${bay}`, spec: specOf(seed, `${scenario}-p-${bay}`, scenario === 'validation' ? VALIDATION_PARKED[bay] : undefined),
      bay, initial: true, noseIn: scenario === 'validation' ? true : !r.chance(0.25), arrival: null, departure: null, pass: null,
    };
    vehicles.push(v);
    holder.set(bay, v);
  }
  if (scenario === 'validation') {
    const s = { scenario, seed, vehicles, events, initialOccupied: [...initial].sort() };
    cache.set(key, s);
    return s;
  }

  /** When each bay is free to be targeted again (after its departure clears it). */
  const freeAt = new Map<string, number>();
  const readyAt = new Map<string, number>(); // vehicle id → time it is parked and may leave
  for (const v of vehicles) readyAt.set(v.id, 0);
  let t = 2000;
  let lastEntry = -Infinity;
  let n = 0;
  const transition = scenario === 'class-transition';
  while (t < HORIZON_MS) {
    let w: { arrive: number; depart: number; pass: number } = cfg.weights;
    if (transition) {
      // Class change every 150 s: first everyone leaves, then the next class arrives.
      const phase = (t / 1000) % 150;
      w = phase < 60 ? { arrive: 0.2, depart: 0.8, pass: 0 } : { arrive: 0.8, depart: 0.2, pass: 0 };
    }
    let kind = r.weighted([['arrive', w.arrive], ['depart', w.depart], ['pass', w.pass]] as const);
    const parked = [...holder.values()].filter((v) => (readyAt.get(v.id) ?? Infinity) <= t);
    const free = SHOWCASE_BAYS.filter((b) => !holder.has(b.id) && (freeAt.get(b.id) ?? 0) <= t);
    if (kind === 'arrive' && !free.length) kind = parked.length ? 'depart' : 'pass';
    if (kind === 'depart' && !parked.length) kind = free.length && w.arrive > 0 ? 'arrive' : 'pass';
    if ((kind === 'arrive' || kind === 'pass') && t - lastEntry < 4500) t = lastEntry + 4500;
    const id = `v${++n}`;
    if (kind === 'arrive') {
      const bay = showcaseBay(r.pick(free).id);
      const spec = specOf(seed, `${scenario}-${id}`);
      const arrival: ScriptedVehicle = { id, spec, startMs: t, legs: arrivalLegs(bay), hiddenBefore: true };
      const v: ShowcaseVehicle = { id, spec, bay: bay.id, initial: false, noseIn: true, arrival, departure: null, pass: null };
      vehicles.push(v);
      holder.set(bay.id, v);
      readyAt.set(id, routeEndMs(arrival) + 4000);
      events.push({ t, kind, vehicle: id, bay: bay.id });
      lastEntry = t;
    } else if (kind === 'depart') {
      const v = r.pick(parked);
      const bay = showcaseBay(v.bay!);
      const from = v.arrival ? (v.arrival.legs.at(-1)!.points.at(-1)! as XZ) : parkedPoint(bay, v.spec);
      v.departure = { id: v.id, spec: v.spec, startMs: t, legs: departureLegs(bay, from, v.noseIn), hiddenAfter: true };
      holder.delete(bay.id);
      freeAt.set(bay.id, t + 12000);
      events.push({ t, kind, vehicle: v.id, bay: bay.id });
    } else {
      const kindOverride: VehicleKind | undefined = scenario === 'occlusion-stress' ? (r.chance(0.6) ? 'van' : 'pickup') : undefined;
      const spec = specOf(seed, `${scenario}-${id}`, kindOverride);
      const pass: ScriptedVehicle = { id, spec, startMs: t, legs: passLegs(), hiddenBefore: true, hiddenAfter: true };
      vehicles.push({ id, spec, bay: null, initial: false, noseIn: true, arrival: null, departure: null, pass });
      events.push({ t, kind, vehicle: id, bay: null });
      lastEntry = t;
    }
    t += r.range(cfg.gap[0], cfg.gap[1]) * 1000;
  }
  const s = { scenario, seed, vehicles, events, initialOccupied: [...initial].sort() };
  cache.set(key, s);
  return s;
}

/** Every vehicle visible at sim time t. */
export function posesAt(schedule: Schedule, t: number): GarageVehiclePose[] {
  const out: GarageVehiclePose[] = [];
  for (const v of schedule.vehicles) {
    if (v.pass) {
      const p = scriptedPose(v.pass, t);
      if (p) out.push(p);
      continue;
    }
    if (v.departure && t >= v.departure.startMs) {
      const p = scriptedPose(v.departure, t);
      if (p) out.push(p);
      continue;
    }
    if (v.arrival) {
      if (t < v.arrival.startMs) continue;
      const p = scriptedPose(v.arrival, t);
      if (p) out.push(p);
      continue;
    }
    // Parked from the start.
    const bay = showcaseBay(v.bay!);
    const [x, z] = parkedPoint(bay, v.spec);
    const heading = parkedHeading(bay, v.noseIn, v.spec);
    out.push({ id: v.id, spec: v.spec, x, z, heading, moving: false, footprint: footprint(x, z, heading, v.spec) });
  }
  return out;
}

export const OCCUPIED_COVERAGE = 0.3;

/** Bays physically occupied (vehicle footprints cover >= 30% of the bay). Ground truth only. */
export function occupiedAt(poses: readonly GarageVehiclePose[]): string[] {
  return SHOWCASE_BAYS.filter((b) => bayCoverage(b as never, poses) >= OCCUPIED_COVERAGE).map((b) => b.id).sort();
}
