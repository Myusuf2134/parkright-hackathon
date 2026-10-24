/**
 * Deterministic garage scenarios: parked vehicles plus scripted routes. Pure data and
 * maths (no three.js, no DOM, no clock), so every pose at every sim time is a function
 * of (scenario, seed, t) and can be tested exactly.
 *
 * A route is a list of legs. Each leg is a polyline sampled from straight lines and
 * quadratic curves, travelled at a cruise speed with an eased start and stop. A reverse
 * leg moves the vehicle backwards (its nose points away from the direction of travel).
 */
import { rng } from '../sim/prng.ts';
import { generateVehicle, type VehicleKind, type VehicleSpec } from '../sim/vehicles.ts';
import { GARAGE, GARAGE_BAYS, garageBay, type GarageBay } from './layout.ts';

export type XZ = [number, number];

export interface Leg {
  points: XZ[];
  /** Cruise speed, m/s. */
  speed: number;
  reverse?: boolean;
  /** Wait at the end of this leg, ms. */
  holdMs?: number;
}

export interface ScriptedVehicle {
  id: string;
  spec: VehicleSpec;
  startMs: number;
  legs: Leg[];
  /** Not in the garage before startMs (still outside the entrance). */
  hiddenBefore?: boolean;
  /** Leaves the garage at the end of its route. */
  hiddenAfter?: boolean;
}

export interface ParkedVehicle {
  bay: string;
  spec: VehicleSpec;
  /** Nose into the bay (true) or reversed in (false). */
  noseIn: boolean;
}

export const SCENARIO_IDS = [
  'static', 'entering', 'exiting', 'pass-by', 'crossing', 'neighbor-approach',
  'fast-approach', 'occlusion', 'full-garage', 'sparse-garage',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const isScenarioId = (v: string): v is ScenarioId => (SCENARIO_IDS as readonly string[]).includes(v);

export interface Scenario {
  id: ScenarioId;
  title: string;
  seed: number;
  durationMs: number;
  camera: 'cam-01';
  parked: ParkedVehicle[];
  movers: ScriptedVehicle[];
  /** Bays expected occupied at the end (for tests and the demo check). */
  occupiedAtEnd: string[];
}

// ---- geometry helpers ------------------------------------------------------------------

const SAMPLES_PER_CURVE = 16;

function quad(a: XZ, c: XZ, b: XZ): XZ[] {
  const out: XZ[] = [];
  for (let i = 1; i <= SAMPLES_PER_CURVE; i++) {
    const t = i / SAMPLES_PER_CURVE;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const LANE_E = GARAGE.aisle.eastLaneZ;
const LANE_W = GARAGE.aisle.westLaneZ;
const OUTSIDE_W = GARAGE.entranceX - 3;
const OUTSIDE_E = GARAGE.exitX + 3;

/** Where a parked vehicle's centre sits in its bay. */
export function parkedPoint(bay: GarageBay, spec: VehicleSpec): XZ {
  // Front wheels near the wheel stop: the car sits 0.35 m deeper than the bay centre.
  const deeper = -bay.opensTo * 0.35;
  return [round(bay.centre[0] + spec.offsetX), round(bay.centre[1] + deeper + spec.offsetZ * 0.4)];
}

/** Heading (rotation about +y, 0 = nose towards +z) of a vehicle parked nose-in or reversed-in. */
export function parkedHeading(bay: GarageBay, noseIn: boolean, spec: VehicleSpec): number {
  // A row opens to +z, so nose-in faces −z (π); B row opens to −z, so nose-in faces +z (0).
  const base = bay.opensTo === 1 ? Math.PI : 0;
  return round((noseIn ? base : base + Math.PI) + spec.yaw);
}

/** Drive in from the west entrance along the east lane and park nose-in. */
function parkRoute(bayId: string, speed: number, approachHoldMs = 0): Leg[] {
  const bay = garageBay(bayId);
  const [bx] = bay.centre;
  const inside: XZ = bay.opensTo === 1 ? [bx, bay.centre[1] - 0.35] : [bx, bay.centre[1] + 0.35];
  const mouth: XZ = bay.opensTo === 1 ? [bx, 7.0] : [bx, 13.0];
  const turnStart: XZ = [bx - 4.6, LANE_E];
  return [
    { points: [[OUTSIDE_W, LANE_E], turnStart], speed, holdMs: approachHoldMs },
    { points: [turnStart, ...quad(turnStart, [bx, LANE_E], mouth), inside], speed: Math.min(speed, 2.2) },
  ];
}

/** Reverse out of a bay, then drive east to the exit ramp. */
function exitRoute(bayId: string, speed: number): Leg[] {
  const bay = garageBay(bayId);
  const [bx, bz] = bay.centre;
  const start: XZ = [bx, bz + (bay.opensTo === 1 ? -0.35 : 0.35)];
  const backTo: XZ = bay.opensTo === 1 ? [bx, 7.2] : [bx, 12.8];
  const swing: XZ = [bx - 3.6, bay.opensTo === 1 ? LANE_E : LANE_W - 0.4];
  return [
    { points: [start, backTo, ...quad(backTo, [bx, bay.opensTo === 1 ? LANE_E : LANE_W], swing)], speed: 1.4, reverse: true, holdMs: 600 },
    { points: [swing, [bx + 1, LANE_E], [OUTSIDE_E, LANE_E]], speed },
  ];
}

const straight = (from: XZ, to: XZ, speed: number): Leg[] => [{ points: [from, to], speed }];

// ---- scenarios --------------------------------------------------------------------------

function parkedSet(seed: number, bays: readonly string[]): ParkedVehicle[] {
  return bays.map((bay) => ({
    bay,
    spec: generateVehicle(seed, bay, 0),
    noseIn: !rng(seed, 'garage-orientation', bay).chance(0.3),
  }));
}

function mover(id: string, kind: VehicleKind, color: string, seed: number): VehicleSpec {
  const base = generateVehicle(seed, `mover-${id}`, 0);
  const dims: Record<VehicleKind, [number, number, number]> = {
    sedan: [4.7, 1.82, 1.45], hatchback: [4.15, 1.76, 1.5], suv: [4.85, 1.95, 1.75], pickup: [5.35, 1.98, 1.85], van: [5.05, 2.0, 2.15],
  };
  const [length, width, height] = dims[kind];
  return { ...base, kind, color, length, width, height, offsetX: 0, offsetZ: 0, yaw: 0 };
}

const DEMO_BAYS = ['A1', 'A3', 'B2', 'B5'] as const;
const ALL_BAYS = GARAGE_BAYS.map((b) => b.id);

export function buildScenario(id: ScenarioId, seed = 4242): Scenario {
  const s = (title: string, durationMs: number, parkedBays: readonly string[], movers: ScriptedVehicle[], occupiedAtEnd: readonly string[]): Scenario => ({
    id, title, seed, durationMs, camera: 'cam-01', parked: parkedSet(seed, parkedBays), movers, occupiedAtEnd: [...occupiedAtEnd].sort(),
  });
  switch (id) {
    case 'static':
      return s('Parked vehicles (demo scene)', 8000, DEMO_BAYS, [], DEMO_BAYS);
    case 'entering':
      return s('A car enters and parks in A5', 18000, ['A1', 'B2'], [
        { id: 'enter-a5', spec: mover('enter-a5', 'sedan', '#8e1b1f', seed), startMs: 1000, legs: parkRoute('A5', 3.2), hiddenBefore: true },
      ], ['A1', 'A5', 'B2']);
    case 'exiting':
      return s('The car in B5 reverses out and leaves', 20000, ['A1', 'A3', 'B2'], [
        { id: 'exit-b5', spec: generateVehicle(seed, 'B5', 0), startMs: 1500, legs: exitRoute('B5', 3.4), hiddenAfter: true },
      ], ['A1', 'A3', 'B2']);
    case 'pass-by':
      return s('A car drives past without parking', 16000, DEMO_BAYS, [
        { id: 'pass', spec: mover('pass', 'suv', '#1f3d73', seed), startMs: 1000, legs: straight([OUTSIDE_W, LANE_E], [OUTSIDE_E, LANE_E], 4.5), hiddenBefore: true, hiddenAfter: true },
      ], DEMO_BAYS);
    case 'crossing':
      return s('Two vehicles cross in the aisle', 18000, DEMO_BAYS, [
        { id: 'east', spec: mover('east', 'sedan', '#e9eaec', seed), startMs: 800, legs: straight([OUTSIDE_W, LANE_E], [OUTSIDE_E, LANE_E], 4.2), hiddenBefore: true, hiddenAfter: true },
        { id: 'west', spec: mover('west', 'van', '#a7abb0', seed), startMs: 800, legs: straight([OUTSIDE_E, LANE_W], [OUTSIDE_W, LANE_W], 3.8), hiddenBefore: true, hiddenAfter: true },
      ], DEMO_BAYS);
    case 'neighbor-approach':
      return s('A car slows at A3 (occupied) and parks in A4', 20000, DEMO_BAYS, [
        { id: 'neighbor', spec: mover('neighbor', 'hatchback', '#c9772b', seed), startMs: 1000, legs: parkRoute('A4', 2.6, 1800), hiddenBefore: true },
      ], [...DEMO_BAYS, 'A4']);
    case 'fast-approach':
      return s('A car arrives fast and parks in B4', 13000, DEMO_BAYS, [
        { id: 'fast', spec: mover('fast', 'sedan', '#16181b', seed), startMs: 800, legs: parkRoute('B4', 7.0), hiddenBefore: true },
      ], [...DEMO_BAYS, 'B4']);
    case 'occlusion':
      return s('A van briefly hides a car parking in A4', 26000, DEMO_BAYS, [
        { id: 'park-a4', spec: mover('park-a4', 'sedan', '#5c6066', seed), startMs: 1000, legs: parkRoute('A4', 2.8), hiddenBefore: true },
        { id: 'van', spec: mover('van', 'van', '#e9eaec', seed), startMs: 5200, legs: straight([OUTSIDE_E, LANE_W], [OUTSIDE_W, LANE_W], 3.0), hiddenBefore: true, hiddenAfter: true },
      ], [...DEMO_BAYS, 'A4']);
    case 'full-garage':
      return s('Every bay occupied', 8000, ALL_BAYS, [], ALL_BAYS);
    case 'sparse-garage':
      return s('Two cars in a quiet garage', 8000, ['A2', 'B5'], [], ['A2', 'B5']);
  }
}

// ---- route evaluation -------------------------------------------------------------------

export interface GarageVehiclePose {
  id: string;
  spec: VehicleSpec;
  x: number;
  z: number;
  heading: number;
  moving: boolean;
  /** Footprint corners on the floor (x, z), for ground truth. */
  footprint: XZ[];
}

interface PreparedLeg {
  leg: Leg;
  cum: number[];
  length: number;
  durationMs: number;
  startMs: number;
}

const prepared = new WeakMap<ScriptedVehicle, PreparedLeg[]>();

function prepare(v: ScriptedVehicle): PreparedLeg[] {
  let p = prepared.get(v);
  if (p) return p;
  p = [];
  let t = v.startMs;
  for (const leg of v.legs) {
    const cum = [0];
    for (let i = 1; i < leg.points.length; i++) {
      const [ax, az] = leg.points[i - 1]!;
      const [bx, bz] = leg.points[i]!;
      cum.push(cum[i - 1]! + Math.hypot(bx - ax, bz - az));
    }
    const length = cum[cum.length - 1]!;
    // Cosine ease in and out: peak speed is cruise; the average is 2/π ≈ 0.64 of it.
    const durationMs = (length / (leg.speed * 0.64)) * 1000;
    p.push({ leg, cum, length, durationMs, startMs: t });
    t += durationMs + (leg.holdMs ?? 0);
  }
  prepared.set(v, p);
  return p;
}

/** When the vehicle's last leg ends. */
export function routeEndMs(v: ScriptedVehicle): number {
  const p = prepare(v);
  const last = p[p.length - 1]!;
  return last.startMs + last.durationMs;
}

function along(pl: PreparedLeg, s: number): { x: number; z: number; dx: number; dz: number } {
  const { points } = pl.leg;
  let i = 1;
  while (i < pl.cum.length - 1 && pl.cum[i]! < s) i++;
  const a = points[i - 1]!;
  const b = points[i]!;
  const seg = pl.cum[i]! - pl.cum[i - 1]!;
  const u = seg > 0 ? Math.min(1, Math.max(0, (s - pl.cum[i - 1]!) / seg)) : 1;
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, dx: b[0] - a[0], dz: b[1] - a[1] };
}

export function footprint(x: number, z: number, heading: number, spec: VehicleSpec): XZ[] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const hw = spec.width / 2;
  const hl = spec.length / 2;
  // Local (lateral, forward) → world: forward = (sin h, cos h), lateral = (cos h, −sin h).
  return ([[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]] as XZ[]).map(([lx, lf]) => [round(x + lx * c + lf * s), round(z - lx * s + lf * c)]);
}

/** Pose of a scripted vehicle at sim time t, or null when it is not in the garage. */
export function scriptedPose(v: ScriptedVehicle, t: number): GarageVehiclePose | null {
  const legs = prepare(v);
  if (t < v.startMs && v.hiddenBefore) return null;
  if (t >= routeEndMs(v) && v.hiddenAfter) return null;
  let pl = legs[0]!;
  let s = 0;
  let moving = false;
  if (t >= v.startMs) {
    pl = legs[legs.length - 1]!;
    s = pl.length;
    for (const l of legs) {
      if (t < l.startMs + l.durationMs) {
        pl = l;
        const u = Math.max(0, (t - l.startMs) / l.durationMs);
        s = l.length * (1 - Math.cos(Math.PI * u)) / 2;
        moving = true;
        break;
      }
      if (t < l.startMs + l.durationMs + (l.leg.holdMs ?? 0)) {
        pl = l;
        s = l.length;
        break;
      }
    }
  }
  const p = along(pl, Math.max(1e-6, s));
  const dir = pl.leg.reverse ? [-p.dx, -p.dz] : [p.dx, p.dz];
  const heading = round(Math.atan2(dir[0]!, dir[1]!));
  const x = round(p.x);
  const z = round(p.z);
  return { id: v.id, spec: v.spec, x, z, heading, moving, footprint: footprint(x, z, heading, v.spec) };
}

export function parkedPose(p: ParkedVehicle): GarageVehiclePose {
  const bay = garageBay(p.bay);
  const [x, z] = parkedPoint(bay, p.spec);
  const heading = parkedHeading(bay, p.noseIn, p.spec);
  return { id: `parked-${p.bay}`, spec: p.spec, x, z, heading, moving: false, footprint: footprint(x, z, heading, p.spec) };
}

/** Every vehicle in the garage at sim time t. Vehicles a mover replaces (it starts parked) are not doubled. */
export function posesAt(scenario: Scenario, t: number): GarageVehiclePose[] {
  const out = scenario.parked.map(parkedPose);
  for (const m of scenario.movers) {
    const pose = scriptedPose(m, t);
    if (pose) out.push(pose);
  }
  return out;
}

// ---- ground truth ------------------------------------------------------------------------

/** A bay is physically occupied when vehicle footprints cover at least this share of it. */
export const OCCUPIED_COVERAGE = 0.3;
const GRID_X = 8;
const GRID_Z = 16;

function insidePolygon(poly: XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function bayCoverage(bay: GarageBay, poses: readonly GarageVehiclePose[]): number {
  let hit = 0;
  const [cx, cz] = bay.centre;
  for (let i = 0; i < GRID_X; i++) {
    for (let k = 0; k < GRID_Z; k++) {
      const x = cx - bay.width / 2 + ((i + 0.5) / GRID_X) * bay.width;
      const z = cz - bay.depth / 2 + ((k + 0.5) / GRID_Z) * bay.depth;
      if (poses.some((p) => insidePolygon(p.footprint, x, z))) hit++;
    }
  }
  return hit / (GRID_X * GRID_Z);
}

export function occupiedBays(poses: readonly GarageVehiclePose[]): string[] {
  return GARAGE_BAYS.filter((b) => bayCoverage(b, poses) >= OCCUPIED_COVERAGE).map((b) => b.id).sort();
}
