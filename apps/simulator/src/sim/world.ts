/**
 * The simulation: a SceneSpec plus time. Pure TypeScript — no React, no WebGL — so
 * the same world can drive the interactive lab or a future headless batch renderer.
 *
 * Time only moves through advance()/step(); nothing reads the wall clock. Vehicles
 * park and leave along a short path when the simulation is playing, and appear or
 * vanish instantly when it is paused. Optional traffic makes seeded arrivals and
 * departures once per simulated second.
 */
import type { CameraPose } from '../camera/pose.ts';
import { AISLE_Z, BAYS, type Bay, bayById, insideBay, SPACE_IDS } from './facility.ts';
import type { PresetId } from './presets.ts';
import { rng } from './prng.ts';
import { defaultSpec, normaliseSeed, type SceneSpec } from './spec.ts';
import { generateVehicle, type VehicleSpec } from './vehicles.ts';

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export const MANOEUVRE_MS = 3200;
export const STEP_MS = 500;
const TRAFFIC_EVENT_PROBABILITY = 0.3;

export interface VehiclePose {
  key: string;
  spaceId: string;
  spec: VehicleSpec;
  x: number;
  z: number;
  /** Rotation about +y; 0 = nose towards +z. */
  heading: number;
  phase: 'arriving' | 'parked' | 'departing';
}

interface Manoeuvre {
  nonce: number;
  kind: 'arrive' | 'depart';
  startMs: number;
}

export type TruthLabel = 'occupied' | 'empty';

/** What the simulator knows. For evaluation only; never part of a camera frame. */
export interface TruthSnapshot {
  readonly simTimeMs: number;
  readonly preset: PresetId;
  readonly spaces: readonly { readonly space_id: string; readonly truth: TruthLabel }[];
}

type Listener = () => void;

export class World {
  spec: SceneSpec;
  simTimeMs = 0;
  playing = false;
  speed: Speed = 1;
  traffic = false;
  selected: string | null = null;
  /** Bumps on every discrete change; UI subscribes to it. */
  version = 0;

  private manoeuvres = new Map<string, Manoeuvre>();
  private nonces = new Map<string, number>();
  private randomizeCount = 0;
  private listeners = new Set<Listener>();

  constructor(spec: SceneSpec = defaultSpec()) {
    this.spec = structuredClone(spec);
    this.spec.seed = normaliseSeed(spec.seed);
    for (const [id, n] of Object.entries(this.spec.occupancy)) this.nonces.set(id, n + 1);
  }

  // ---- subscription -----------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- time ---------------------------------------------------------------------------

  /** Advances simulated time by wall-clock `dtMs` × speed, if playing. */
  advance(dtMs: number): void {
    if (!this.playing || dtMs <= 0) return;
    this.advanceSim(Math.min(dtMs, 250) * this.speed);
  }

  /** Advances simulated time by one step regardless of play state. */
  step(): void {
    this.advanceSim(STEP_MS);
    this.changed();
  }

  private advanceSim(dt: number): void {
    const before = this.simTimeMs;
    this.simTimeMs = before + dt;
    if (this.traffic) {
      for (let s = Math.floor(before / 1000) + 1; s <= Math.floor(this.simTimeMs / 1000); s++) this.trafficEvent(s);
    }
    let finished = false;
    for (const [id, m] of this.manoeuvres) {
      if (this.simTimeMs - m.startMs >= MANOEUVRE_MS) {
        this.manoeuvres.delete(id);
        finished = true;
      }
    }
    if (finished) this.changed();
  }

  private trafficEvent(second: number): void {
    const r = rng(this.spec.seed, 'traffic', second);
    if (!r.chance(TRAFFIC_EVENT_PROBABILITY)) return;
    const id = r.pick(SPACE_IDS);
    if (this.manoeuvres.has(id)) return;
    if (id in this.spec.occupancy) this.remove(id);
    else this.park(id);
  }

  play(): void {
    this.playing = true;
    this.changed();
  }

  pause(): void {
    this.playing = false;
    this.changed();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.changed();
  }

  setTraffic(on: boolean): void {
    this.traffic = on;
    this.changed();
  }

  /** Back to an empty deck at t = 0 with the same seed, preset and camera. */
  reset(): void {
    this.spec = { ...this.spec, occupancy: {} };
    this.simTimeMs = 0;
    this.playing = false;
    this.manoeuvres.clear();
    this.nonces.clear();
    this.randomizeCount = 0;
    this.changed();
  }

  // ---- scene ----------------------------------------------------------------------------

  setSeed(seed: number): void {
    this.spec = { ...this.spec, seed: normaliseSeed(seed) };
    this.reset();
  }

  setPreset(preset: PresetId): void {
    this.spec = { ...this.spec, preset };
    this.changed();
  }

  setCamera(camera: CameraPose): void {
    this.spec = { ...this.spec, camera };
    this.changed();
  }

  /** Replaces the whole scene (e.g. from a shared URL). Time restarts at 0. */
  load(spec: SceneSpec): void {
    this.spec = structuredClone({ ...spec, seed: normaliseSeed(spec.seed) });
    this.simTimeMs = 0;
    this.playing = false;
    this.manoeuvres.clear();
    this.nonces = new Map(Object.entries(spec.occupancy).map(([id, n]) => [id, n + 1]));
    this.changed();
  }

  select(spaceId: string | null): void {
    this.selected = spaceId;
    this.changed();
  }

  // ---- occupancy ------------------------------------------------------------------------

  private nextNonce(spaceId: string): number {
    const n = this.nonces.get(spaceId) ?? 0;
    this.nonces.set(spaceId, n + 1);
    return n;
  }

  park(spaceId: string, nonce = this.nextNonce(spaceId)): void {
    bayById(spaceId);
    if (spaceId in this.spec.occupancy || this.manoeuvres.get(spaceId)?.kind === 'depart') return;
    this.spec = { ...this.spec, occupancy: { ...this.spec.occupancy, [spaceId]: nonce } };
    if (this.playing) this.manoeuvres.set(spaceId, { nonce, kind: 'arrive', startMs: this.simTimeMs });
    this.changed();
  }

  remove(spaceId: string): void {
    const nonce = this.spec.occupancy[spaceId];
    if (nonce === undefined) return;
    const { [spaceId]: _, ...rest } = this.spec.occupancy;
    this.spec = { ...this.spec, occupancy: rest };
    if (this.playing) this.manoeuvres.set(spaceId, { nonce, kind: 'depart', startMs: this.simTimeMs });
    else this.manoeuvres.delete(spaceId);
    this.changed();
  }

  clearAll(): void {
    for (const id of SPACE_IDS) this.remove(id);
  }

  fillAll(): void {
    for (const id of SPACE_IDS) this.park(id);
  }

  /** A seeded random layout: the n-th randomize for a seed always gives the same result. */
  randomize(): void {
    const r = rng(this.spec.seed, 'randomize', this.randomizeCount++);
    this.manoeuvres.clear();
    const occupancy: Record<string, number> = {};
    for (const id of SPACE_IDS) if (r.chance(0.5)) occupancy[id] = r.int(0, 10_000);
    this.spec = { ...this.spec, occupancy };
    for (const [id, n] of Object.entries(occupancy)) this.nonces.set(id, n + 1);
    this.changed();
  }

  // ---- what is where --------------------------------------------------------------------

  /** Every vehicle currently on the deck, with its pose at the current sim time. */
  vehicles(): VehiclePose[] {
    const out: VehiclePose[] = [];
    for (const bay of BAYS) {
      const id = bay.spaceId;
      const m = this.manoeuvres.get(id);
      const nonce = m?.nonce ?? this.spec.occupancy[id];
      if (nonce === undefined) continue;
      const spec = generateVehicle(this.spec.seed, id, nonce);
      const parked = parkedPose(bay, spec);
      if (!m) {
        out.push({ key: `${id}:${nonce}`, spaceId: id, spec, ...parked, phase: 'parked' });
        continue;
      }
      const t = Math.min(1, Math.max(0, (this.simTimeMs - m.startMs) / MANOEUVRE_MS));
      const progress = m.kind === 'arrive' ? t : 1 - t;
      out.push({ key: `${id}:${nonce}`, spaceId: id, spec, ...manoeuvrePose(bay, parked, progress), phase: m.kind === 'arrive' ? 'arriving' : 'departing' });
    }
    return out;
  }

  /**
   * Ground truth from vehicle positions: a bay is occupied when a vehicle's centre is
   * inside it — including one that is still pulling in or out.
   */
  truth(): TruthSnapshot {
    const vehicles = this.vehicles();
    return {
      simTimeMs: Math.floor(this.simTimeMs),
      preset: this.spec.preset,
      spaces: BAYS.map((bay) => ({
        space_id: bay.spaceId,
        truth: vehicles.some((v) => insideBay(bay, v.x, v.z)) ? 'occupied' : 'empty',
      })),
    };
  }
}

function parkedPose(bay: Bay, v: VehicleSpec): { x: number; z: number; heading: number } {
  // Nose-in: the vehicle faces away from the aisle.
  const heading = (bay.opensTo === 1 ? Math.PI : 0) + v.yaw;
  return { x: bay.x + v.offsetX, z: bay.z + v.offsetZ, heading };
}

/** Quadratic path from the aisle into the bay. progress 0 = in the aisle, 1 = parked. */
function manoeuvrePose(bay: Bay, parked: { x: number; z: number; heading: number }, progress: number) {
  const e = progress * progress * (3 - 2 * progress);
  const start = { x: bay.x + 7, z: AISLE_Z };
  const control = { x: bay.x, z: AISLE_Z };
  const u = 1 - e;
  const x = u * u * start.x + 2 * u * e * control.x + e * e * parked.x;
  const z = u * u * start.z + 2 * u * e * control.z + e * e * parked.z;
  const dx = 2 * u * (control.x - start.x) + 2 * e * (parked.x - control.x);
  const dz = 2 * u * (control.z - start.z) + 2 * e * (parked.z - control.z);
  const heading = e >= 0.999 ? parked.heading : Math.atan2(dx, dz);
  return { x, z, heading };
}
