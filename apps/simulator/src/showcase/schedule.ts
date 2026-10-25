/**
 * The deterministic traffic scheduler shared by every showcase site (the 34-space garage and the
 * Ohio Union North Garage-inspired simulation). Pure TypeScript (no three.js, no DOM, no clock):
 * everything at sim time t is a function of (site, scenario, seed, t).
 *
 * A site supplies its bays, its scenario sizes and its routes (arrival, departure, pass-through);
 * the scheduler runs a small simulation of bay reservations up front for 30 minutes of sim time,
 * so no two vehicles target the same bay and entries through one gate are spaced out.
 */
import { bayCoverage, footprint, type GarageVehiclePose, type Leg, type ScriptedVehicle, scriptedPose, routeEndMs, type XZ } from '../garage/scenarios.ts';
import { type Rng, rng } from '../sim/prng.ts';
import { generateVehicle, type VehicleKind, type VehicleSpec } from '../sim/vehicles.ts';

export type { GarageVehiclePose as VehiclePose, XZ };
export type Vec3 = [number, number, number];

/** The scenario IDs every site offers (each site sizes them for its own number of bays). */
export const SCENARIO_IDS = [
  'live', 'morning-rush', 'class-transition', 'nearly-full', 'sparse', 'entering', 'exiting', 'occlusion-stress', 'pass-through', 'validation',
] as const;
export type ShowcaseScenarioId = (typeof SCENARIO_IDS)[number];
export const isShowcaseScenario = (v: string): v is ShowcaseScenarioId => (SCENARIO_IDS as readonly string[]).includes(v);

export interface ScenarioConfig {
  title: string;
  initial: number;
  gap: readonly [number, number];
  weights: { readonly arrive: number; readonly depart: number; readonly pass: number };
}

export interface SiteBay {
  id: string;
  row: string;
  level: 'L1';
  owner: string;
  /** Floor corners, world metres: NW, NE, SE, SW. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  centre: [number, number];
  width: number;
  depth: number;
  /** Direction from the bay into its aisle: +1 south, −1 north. */
  opensTo: 1 | -1;
}

/** What the scheduler needs from a site. */
export interface TrafficSite {
  /** rng namespace; changing it changes every schedule of the site. */
  rngLabel: string;
  bays: readonly SiteBay[];
  scenarios: Record<ShowcaseScenarioId, ScenarioConfig>;
  /** The static validation scene: bay → vehicle kind. */
  validationParked: Readonly<Record<string, VehicleKind>>;
  arrivalLegs(b: SiteBay): Leg[];
  departureLegs(b: SiteBay, from: XZ, noseIn: boolean): Leg[];
  /** Pass-through route. A site may draw from `r` to vary routes; a site that does not draw keeps its schedules unchanged. */
  passLegs(r: Rng): Leg[];
  /** Vehicle kinds forced for pass-through traffic in the occlusion-stress scenario. */
  occlusionKinds?: readonly VehicleKind[];
}

export const HORIZON_MS = 30 * 60 * 1000;

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

/** Inside point (where the car stops) and mouth (where it enters the bay). */
export function bayPoints(b: SiteBay): { inside: XZ; mouth: XZ } {
  const [bx, bz] = b.centre;
  const deeper = -b.opensTo * 0.3;
  const mouthZ = b.opensTo === 1 ? b.corners[2][2] - 0.6 : b.corners[0][2] + 0.6;
  return { inside: [bx, +(bz + deeper).toFixed(3)], mouth: [bx, +mouthZ.toFixed(3)] };
}

function parkedPoint(b: SiteBay, spec: VehicleSpec): XZ {
  const { inside } = bayPoints(b);
  return [+(inside[0] + spec.offsetX * 0.6).toFixed(4), +(inside[1] + spec.offsetZ * 0.3).toFixed(4)];
}
function parkedHeading(b: SiteBay, noseIn: boolean, spec: VehicleSpec): number {
  const base = b.opensTo === 1 ? Math.PI : 0; // nose-in faces away from the aisle
  return +((noseIn ? base : base + Math.PI) + spec.yaw).toFixed(6);
}

const SAMPLES = 14;
/** Quadratic curve from a through control point c to b (a excluded). */
export function quad(a: XZ, c: XZ, b: XZ): XZ[] {
  const out: XZ[] = [];
  for (let i = 1; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    out.push([+(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]).toFixed(4), +(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]).toFixed(4)]);
  }
  return out;
}

const caches = new WeakMap<TrafficSite, Map<string, Schedule>>();
const siteOf = new WeakMap<Schedule, TrafficSite>();

/** The full deterministic schedule for a scenario at a site (cached per site). */
export function buildSiteSchedule(site: TrafficSite, scenario: ShowcaseScenarioId, seed = 4242): Schedule {
  let cache = caches.get(site);
  if (!cache) caches.set(site, (cache = new Map()));
  const key = `${scenario}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const bayById = new Map(site.bays.map((b) => [b.id, b]));
  const bayOf = (id: string) => bayById.get(id)!;
  const cfg = site.scenarios[scenario];
  const r = rng(seed, site.rngLabel, scenario);
  const vehicles: ShowcaseVehicle[] = [];
  const events: ScheduleEvent[] = [];
  const done = (): Schedule => {
    const s = { scenario, seed, vehicles, events, initialOccupied: [...initial].sort() };
    cache.set(key, s);
    siteOf.set(s, site);
    return s;
  };

  // Initial parked set: a seeded shuffle of the bays (the validation scene is fixed).
  const order = [...site.bays.map((b) => b.id)];
  for (let i = order.length - 1; i > 0; i--) {
    const j = r.int(0, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const validation = scenario === 'validation';
  const initial = validation ? Object.keys(site.validationParked) : order.slice(0, cfg.initial);
  /** bay → vehicle parked (or arriving) there. */
  const holder = new Map<string, ShowcaseVehicle>();
  for (const bay of initial) {
    const v: ShowcaseVehicle = {
      id: `p-${bay}`, spec: specOf(seed, `${scenario}-p-${bay}`, validation ? site.validationParked[bay] : undefined),
      bay, initial: true, noseIn: validation ? true : !r.chance(0.25), arrival: null, departure: null, pass: null,
    };
    vehicles.push(v);
    holder.set(bay, v);
  }
  if (validation) return done();

  /** When each bay is free to be targeted again (after its departure clears it). */
  const freeAt = new Map<string, number>();
  const readyAt = new Map<string, number>(); // vehicle id → time it is parked and may leave
  for (const v of vehicles) readyAt.set(v.id, 0);
  let t = 2000;
  let lastEntry = -Infinity;
  let n = 0;
  const transition = scenario === 'class-transition';
  while (t < HORIZON_MS) {
    let w: ScenarioConfig['weights'] = cfg.weights;
    if (transition) {
      // Class change every 150 s: first everyone leaves, then the next class arrives.
      const phase = (t / 1000) % 150;
      w = phase < 60 ? { arrive: 0.2, depart: 0.8, pass: 0 } : { arrive: 0.8, depart: 0.2, pass: 0 };
    }
    let kind = r.weighted([['arrive', w.arrive], ['depart', w.depart], ['pass', w.pass]] as const);
    const parked = [...holder.values()].filter((v) => (readyAt.get(v.id) ?? Infinity) <= t);
    const free = site.bays.filter((b) => !holder.has(b.id) && (freeAt.get(b.id) ?? 0) <= t);
    if (kind === 'arrive' && !free.length) kind = parked.length ? 'depart' : 'pass';
    if (kind === 'depart' && !parked.length) kind = free.length && w.arrive > 0 ? 'arrive' : 'pass';
    if ((kind === 'arrive' || kind === 'pass') && t - lastEntry < 4500) t = lastEntry + 4500;
    const id = `v${++n}`;
    if (kind === 'arrive') {
      const bay = bayOf(r.pick(free).id);
      const spec = specOf(seed, `${scenario}-${id}`);
      const arrival: ScriptedVehicle = { id, spec, startMs: t, legs: site.arrivalLegs(bay), hiddenBefore: true };
      const v: ShowcaseVehicle = { id, spec, bay: bay.id, initial: false, noseIn: true, arrival, departure: null, pass: null };
      vehicles.push(v);
      holder.set(bay.id, v);
      readyAt.set(id, routeEndMs(arrival) + 4000);
      events.push({ t, kind, vehicle: id, bay: bay.id });
      lastEntry = t;
    } else if (kind === 'depart') {
      const v = r.pick(parked);
      const bay = bayOf(v.bay!);
      const from = v.arrival ? (v.arrival.legs.at(-1)!.points.at(-1)! as XZ) : parkedPoint(bay, v.spec);
      v.departure = { id: v.id, spec: v.spec, startMs: t, legs: site.departureLegs(bay, from, v.noseIn), hiddenAfter: true };
      holder.delete(bay.id);
      freeAt.set(bay.id, t + 12000);
      events.push({ t, kind, vehicle: v.id, bay: bay.id });
    } else {
      const kinds = site.occlusionKinds ?? ['van', 'pickup'];
      const kindOverride: VehicleKind | undefined = scenario === 'occlusion-stress' ? (r.chance(0.6) ? kinds[0] : kinds[1]) : undefined;
      const spec = specOf(seed, `${scenario}-${id}`, kindOverride);
      const pass: ScriptedVehicle = { id, spec, startMs: t, legs: site.passLegs(r), hiddenBefore: true, hiddenAfter: true };
      vehicles.push({ id, spec, bay: null, initial: false, noseIn: true, arrival: null, departure: null, pass });
      events.push({ t, kind, vehicle: id, bay: null });
      lastEntry = t;
    }
    t += r.range(cfg.gap[0], cfg.gap[1]) * 1000;
  }
  return done();
}

/** Every vehicle visible at sim time t. */
export function posesAt(schedule: Schedule, t: number): GarageVehiclePose[] {
  const site = siteOf.get(schedule);
  if (!site) throw new Error('schedule was not built by buildSiteSchedule');
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
    const bay = site.bays.find((b) => b.id === v.bay)!;
    const [x, z] = parkedPoint(bay, v.spec);
    const heading = parkedHeading(bay, v.noseIn, v.spec);
    out.push({ id: v.id, spec: v.spec, x, z, heading, moving: false, footprint: footprint(x, z, heading, v.spec) });
  }
  return out;
}

export const OCCUPIED_COVERAGE = 0.3;

/** Bays physically occupied (vehicle footprints cover >= 30% of the bay). Ground truth only. */
export function occupiedIn(bays: readonly SiteBay[], poses: readonly GarageVehiclePose[]): string[] {
  return bays.filter((b) => bayCoverage(b as never, poses) >= OCCUPIED_COVERAGE).map((b) => b.id).sort();
}

export type { Leg, Rng };
