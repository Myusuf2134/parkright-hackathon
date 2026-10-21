/**
 * OFFLINE TEMPORAL DATASET v2 plan: scripted vehicle motion for bay-specific tracking evaluation.
 *
 * v1 (temporal.ts) could only park or remove a vehicle through World, which makes cars appear
 * and vanish mid-aisle. v2 scripts every moving vehicle as a deterministic path: drive along
 * the aisle from beyond the lot edge, curve into a bay (the same quadratic path as World), back
 * out, drive past without parking, pause in front of a bay, start toward a bay and abort.
 * Parked vehicles that never move still come from World. Scripted vehicles are rendered by the
 * real scene through World.vehicles(), so pixels, boxes and truth all follow from one state.
 *
 * Every sequence keeps at least one vehicle moving inside the visible lot in every frame, so
 * consecutive frames are always distinct scene states.
 *
 * Splits: the unit is the scene seed. Seeds come from hash(dataset_seed, 'temporal-v2-seed', i);
 * they are cut into reference / dev / test by hash order. The reference split holds single
 * calibration captures (empty bays designated per capture) and never contributes to DEV or TEST.
 * Pure and deterministic; Math.random is never used.
 */
import type { CameraPose } from '../camera/pose.ts';
import { AISLE_Z, BAYS, bayById, insideBay, SPACE_IDS } from '../sim/facility.ts';
import { isPresetId, type PresetId } from '../sim/presets.ts';
import { hashKey, type Rng, rng } from '../sim/prng.ts';
import { normaliseSeed } from '../sim/spec.ts';
import { generateVehicle, type VehicleSpec } from '../sim/vehicles.ts';
import { MANOEUVRE_MS, type VehiclePose, World } from '../sim/world.ts';
import type { Density, RowPattern } from './config.ts';
import { crate, type OccluderSpec, pillars, screen } from './occluders.ts';
import { densityOf } from './plan.ts';

export const TEMPORAL_V2_SCHEMA = 'parkright-temporal-dataset-v2';

export type V2Split = 'reference' | 'dev' | 'test';
export type V2Family =
  | 'settled_empty' | 'settled_sparse' | 'settled_medium' | 'settled_dense' | 'settled_full'
  | 'entering' | 'exiting' | 'aborted_approach' | 'pass_by' | 'neighbor_approach' | 'two_vehicles'
  | 'pause_near' | 'detector_dropout' | 'occluded_approach' | 'occlusion_partial' | 'occlusion_severe'
  | 'large_vehicles' | 'row_pattern';
export const V2_FAMILIES: readonly V2Family[] = [
  'settled_empty', 'settled_sparse', 'settled_medium', 'settled_dense', 'settled_full',
  'entering', 'exiting', 'aborted_approach', 'pass_by', 'neighbor_approach', 'two_vehicles',
  'pause_near', 'detector_dropout', 'occluded_approach', 'occlusion_partial', 'occlusion_severe',
  'large_vehicles', 'row_pattern',
];
const SHORT: Record<V2Family, string> = {
  settled_empty: 'emp', settled_sparse: 'spa', settled_medium: 'med', settled_dense: 'den', settled_full: 'ful',
  entering: 'ent', exiting: 'exi', aborted_approach: 'abo', pass_by: 'pas', neighbor_approach: 'nei', two_vehicles: 'two',
  pause_near: 'pau', detector_dropout: 'drp', occluded_approach: 'oca', occlusion_partial: 'ocp', occlusion_severe: 'ocs',
  large_vehicles: 'lrg', row_pattern: 'row',
};

export interface TemporalV2Config {
  kind: 'temporal-v2';
  name: string;
  dataset_seed: number;
  seed_groups: { reference: number; dev: number; test: number };
  /** Sequences per scene seed for each family. */
  sequences_per_seed: number;
  frames: { count: number; interval_ms: number };
  density_ranges: Record<'sparse' | 'medium' | 'dense', [number, number]>;
  presets: PresetId[];
  families: V2Family[];
  large_vehicle_kinds: string[];
  /** Calibration captures per preset in the reference split: one empty deck, the rest partly occupied. */
  reference_layouts_per_preset: number;
  aisle_speed_mps: [number, number];
  /** Consecutive frames whose detections the evaluation harness blanks (detector_dropout family). */
  dropout_frames: number;
  /** Labels mark a bay that becomes occupied within this horizon (ms). */
  future_horizon_ms: number;
}

export type Phase = 'entering' | 'exiting' | 'approaching' | 'aborting' | 'paused_near';
export interface Tag {
  space_id: string;
  phase: Phase;
}
export type Segment =
  | { kind: 'line'; t0: number; t1: number; from: [number, number]; to: [number, number]; tag?: Tag }
  | { kind: 'hold'; t0: number; t1: number; tag?: Tag }
  /** Along the World arrival curve of `space_id` entered from `side`, path progress p0 → p1 (0 aisle, 1 parked). */
  | { kind: 'bay'; t0: number; t1: number; space_id: string; side: 1 | -1; p0: number; p1: number; tag?: Tag };

export interface VehicleScript {
  id: string;
  /** Vehicle appearance: generateVehicle(seed, spec_space, nonce). */
  spec_space: string;
  nonce: number;
  /** Label space id: the bay it parks in or leaves, otherwise 'aisle'. */
  space_id: string;
  motion: 'arrive' | 'depart' | 'pass_by' | 'aborted' | 'pause';
  role: 'target' | 'background';
  segments: Segment[];
  /** Present before the first segment (a parked car that later departs). */
  present_before: boolean;
  /** After the last segment: stays at its final pose, or has left the lot. */
  end: 'stay' | 'vanish';
}

export type BayRole = 'target' | 'neighbor' | 'other';

export interface TemporalV2FramePlan {
  sample_id: string;
  split: V2Split;
  subset: 'temporal' | 'reference';
  group_id: string;
  scenario_id: string;
  sequence_id: string;
  family: V2Family | 'reference';
  seed: number;
  preset: PresetId;
  density: Density;
  /** Bays occupied at sequence start (including vehicles that depart later), with the vehicle nonce. */
  occupancy: Record<string, number>;
  occluders: OccluderSpec[];
  scripts: VehicleScript[];
  pattern: RowPattern | null;
  roles: Record<string, BayRole>;
  /** Frame indices whose detections the evaluation harness removes (a simulated detector outage). */
  dropout_frames: number[];
  frame_index: number;
  frame_count: number;
  t_ms: number;
  future_horizon_ms: number;
  v2: true;
}

const ROW_PATTERNS: Record<RowPattern, string[]> = {
  row_a_only: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  row_b_only: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
  checkerboard: ['A1', 'A3', 'A5', 'B2', 'B4', 'B6'],
};
const PATTERNS = Object.keys(ROW_PATTERNS) as RowPattern[];
/** Lot x range the camera sees in the aisle (m); scripted vehicles start and end well outside it. */
export const VISIBLE_X: [number, number] = [-1, 21];
const EDGE = { [-1]: -12, 1: 32 } as const;
const LANE = 0.9;

export function validateTemporalV2Config(c: TemporalV2Config): TemporalV2Config {
  const fail = (msg: string) => {
    throw new Error(`invalid temporal-v2 config: ${msg}`);
  };
  if (c.kind !== 'temporal-v2') fail('kind must be "temporal-v2"');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(c.name)) fail('name must be a short lowercase slug');
  if (!Number.isInteger(c.dataset_seed) || c.dataset_seed < 0) fail('dataset_seed');
  if (!(c.seed_groups.reference >= 1 && c.seed_groups.dev >= 1 && c.seed_groups.test >= 1)) fail('reference, dev and test need a seed each');
  if (!(Number.isInteger(c.frames.count) && c.frames.count >= 10)) fail('a sequence needs at least 10 frames');
  if (!(c.frames.interval_ms > 0)) fail('interval_ms');
  if (!(Number.isInteger(c.sequences_per_seed) && c.sequences_per_seed >= 1)) fail('sequences_per_seed');
  for (const p of c.presets) if (!isPresetId(p)) fail(`unsupported environment preset ${p}`);
  if (c.presets.length !== 4) fail('all four presets are required');
  for (const f of c.families) if (!V2_FAMILIES.includes(f)) fail(`unknown family ${f}`);
  if (new Set(c.families).size !== c.families.length) fail('families repeat');
  if (!(c.reference_layouts_per_preset >= 1)) fail('reference_layouts_per_preset');
  if (!(c.aisle_speed_mps[0] > 0 && c.aisle_speed_mps[1] >= c.aisle_speed_mps[0])) fail('aisle_speed_mps');
  if (!(c.dropout_frames >= 1 && c.dropout_frames < c.frames.count)) fail('dropout_frames');
  return c;
}

function shuffled<T>(r: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = r.int(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function sceneSeeds(datasetSeed: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < n; i++) {
    const s = normaliseSeed(hashKey(datasetSeed, 'temporal-v2-seed', i) & 0x7fffffff);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function assignV2Splits(datasetSeed: number, seeds: readonly number[], groups: TemporalV2Config['seed_groups']): Map<number, V2Split> {
  const order = [...seeds].sort((a, b) => hashKey(datasetSeed, 'split', a) - hashKey(datasetSeed, 'split', b) || a - b);
  return new Map(order.map((s, i) => [s, i < groups.reference ? 'reference' : i < groups.reference + groups.dev ? 'dev' : 'test']));
}

// ---- motion ------------------------------------------------------------------------------

const smooth = (p: number) => p * p * (3 - 2 * p);

function parkedPose(spaceId: string, v: VehicleSpec) {
  const bay = bayById(spaceId);
  return { x: bay.x + v.offsetX, z: bay.z + v.offsetZ, heading: (bay.opensTo === 1 ? Math.PI : 0) + v.yaw };
}

/** World's arrival path (world.ts manoeuvrePose), generalised to either aisle side. */
function bayPose(spaceId: string, side: 1 | -1, v: VehicleSpec, p: number) {
  const bay = bayById(spaceId);
  const parked = parkedPose(spaceId, v);
  const e = smooth(Math.min(1, Math.max(0, p)));
  const start = { x: bay.x + 7 * side, z: AISLE_Z };
  const control = { x: bay.x, z: AISLE_Z };
  const u = 1 - e;
  const x = u * u * start.x + 2 * u * e * control.x + e * e * parked.x;
  const z = u * u * start.z + 2 * u * e * control.z + e * e * parked.z;
  const dx = 2 * u * (control.x - start.x) + 2 * e * (parked.x - control.x);
  const dz = 2 * u * (control.z - start.z) + 2 * e * (parked.z - control.z);
  return { x, z, heading: e >= 0.999 ? parked.heading : Math.atan2(dx, dz) };
}

function segmentPose(s: Exclude<Segment, { kind: 'hold' }>, t: number, v: VehicleSpec) {
  const f = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
  if (s.kind === 'line') {
    const [x0, z0] = s.from;
    const [x1, z1] = s.to;
    return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, heading: Math.atan2(x1 - x0, z1 - z0) };
  }
  return bayPose(s.space_id, s.side, v, s.p0 + (s.p1 - s.p0) * f);
}

export function scriptPose(script: VehicleScript, seed: number, t: number): VehiclePose | null {
  const spec = generateVehicle(seed, script.spec_space, script.nonce);
  const segs = script.segments;
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  if (t < first.t0 && !script.present_before) return null;
  if (t > last.t1 && script.end === 'vanish') return null;
  // A leading hold takes the pose at the start of the next moving segment.
  const startPose = (i: number): { x: number; z: number; heading: number } => {
    const s = segs[i]!;
    return s.kind === 'hold' ? startPose(i + 1) : segmentPose(s, s.t0, spec);
  };
  let pose = startPose(0);
  for (const s of segs) {
    if (t < s.t0) break;
    if (s.kind !== 'hold') pose = segmentPose(s, Math.min(t, s.t1), spec);
  }
  const phase = script.motion === 'arrive' && t >= last.t1 ? 'parked' : script.motion === 'depart' ? 'departing' : 'arriving';
  return { key: `script:${script.id}`, spaceId: script.space_id, spec, x: pose.x, z: pose.z, heading: pose.heading, phase };
}

/** Bay phases active at time t (truth-side labels; priority entering/exiting > approaching > aborting > paused_near). */
export function phasesAt(scripts: readonly VehicleScript[], t: number): Record<string, Phase> {
  const rank: Phase[] = ['entering', 'exiting', 'approaching', 'aborting', 'paused_near'];
  const out: Record<string, Phase> = {};
  for (const sc of scripts) {
    for (const s of sc.segments) {
      if (!s.tag || t < s.t0 || t >= s.t1) continue;
      const cur = out[s.tag.space_id];
      if (!cur || rank.indexOf(s.tag.phase) < rank.indexOf(cur)) out[s.tag.space_id] = s.tag.phase;
    }
  }
  return out;
}

interface Builder {
  seed: number;
  r: Rng;
  speed: () => number;
  scripts: VehicleScript[];
  next: () => string;
}

const lineMs = (from: [number, number], to: [number, number], v: number) => (Math.hypot(to[0] - from[0], to[1] - from[1]) / v) * 1000;

function arrive(b: Builder, spaceId: string, side: 1 | -1, ta: number, nonce: number, role: VehicleScript['role']): VehicleScript {
  const bay = bayById(spaceId);
  const start: [number, number] = [bay.x + 7 * side, AISLE_Z];
  const edge: [number, number] = [EDGE[side], AISLE_Z];
  const lead = lineMs(edge, start, b.speed());
  const s: VehicleScript = {
    id: b.next(), spec_space: spaceId, nonce, space_id: spaceId, motion: 'arrive', role, present_before: false, end: 'stay',
    segments: [
      { kind: 'line', t0: ta - lead, t1: ta, from: edge, to: start },
      { kind: 'bay', t0: ta, t1: ta + MANOEUVRE_MS, space_id: spaceId, side, p0: 0, p1: 1, tag: { space_id: spaceId, phase: 'entering' } },
    ],
  };
  b.scripts.push(s);
  return s;
}

function depart(b: Builder, spaceId: string, side: 1 | -1, td: number, nonce: number, role: VehicleScript['role']): VehicleScript {
  const bay = bayById(spaceId);
  const start: [number, number] = [bay.x + 7 * side, AISLE_Z];
  const edge: [number, number] = [EDGE[side], AISLE_Z];
  const s: VehicleScript = {
    id: b.next(), spec_space: spaceId, nonce, space_id: spaceId, motion: 'depart', role, present_before: true, end: 'vanish',
    segments: [
      { kind: 'bay', t0: td, t1: td + MANOEUVRE_MS, space_id: spaceId, side, p0: 1, p1: 0, tag: { space_id: spaceId, phase: 'exiting' } },
      { kind: 'line', t0: td + MANOEUVRE_MS, t1: td + MANOEUVRE_MS + lineMs(start, edge, b.speed()), from: start, to: edge },
    ],
  };
  b.scripts.push(s);
  return s;
}

function passBy(b: Builder, dir: 1 | -1, t0: number, role: VehicleScript['role'] = 'background'): VehicleScript {
  const z = AISLE_Z + LANE * dir; // keep right: eastbound on the camera side
  const from: [number, number] = [EDGE[(-dir) as 1 | -1], z];
  const to: [number, number] = [EDGE[dir], z];
  const s: VehicleScript = {
    id: b.next(), spec_space: 'aisle', nonce: b.r.int(0, 1_000_000), space_id: 'aisle', motion: 'pass_by', role, present_before: false, end: 'vanish',
    segments: [{ kind: 'line', t0, t1: t0 + lineMs(from, to, b.speed()), from, to }],
  };
  b.scripts.push(s);
  return s;
}

/** Starts toward a bay along its arrival curve, stops, backs out and drives on past it. */
function aborted(b: Builder, spaceId: string, side: 1 | -1, ta: number): VehicleScript {
  const bay = bayById(spaceId);
  const start: [number, number] = [bay.x + 7 * side, AISLE_Z];
  const edge: [number, number] = [EDGE[side], AISLE_Z];
  const nonce = b.r.int(0, 1_000_000);
  const v = generateVehicle(b.seed, spaceId, nonce);
  const backed = bayPose(spaceId, side, v, 0.1);
  const away: [number, number] = [EDGE[(-side) as 1 | -1], AISLE_Z];
  const speed = b.speed();
  const turn = 1000;
  const total = lineMs([backed.x, backed.z], away, speed);
  const mid: [number, number] = [backed.x + (away[0] - backed.x) * (turn / total), backed.z + (away[1] - backed.z) * (turn / total)];
  const s: VehicleScript = {
    id: b.next(), spec_space: spaceId, nonce, space_id: 'aisle', motion: 'aborted', role: 'target', present_before: false, end: 'vanish',
    segments: [
      { kind: 'line', t0: ta - lineMs(edge, start, speed), t1: ta, from: edge, to: start },
      { kind: 'bay', t0: ta, t1: ta + 1600, space_id: spaceId, side, p0: 0, p1: 0.5, tag: { space_id: spaceId, phase: 'approaching' } },
      { kind: 'hold', t0: ta + 1600, t1: ta + 2100, tag: { space_id: spaceId, phase: 'aborting' } },
      { kind: 'bay', t0: ta + 2100, t1: ta + 3100, space_id: spaceId, side, p0: 0.5, p1: 0.1, tag: { space_id: spaceId, phase: 'aborting' } },
      { kind: 'line', t0: ta + 3100, t1: ta + 3100 + turn, from: [backed.x, backed.z], to: mid, tag: { space_id: spaceId, phase: 'aborting' } },
      { kind: 'line', t0: ta + 3100 + turn, t1: ta + 3100 + total, from: mid, to: away },
    ],
  };
  b.scripts.push(s);
  return s;
}

/** Drives along the aisle, stops in front of a bay for `hold` ms, then drives on. */
function pause(b: Builder, spaceId: string, side: 1 | -1, tp: number, hold: number): VehicleScript {
  const bay = bayById(spaceId);
  const toward = bay.opensTo === 1 ? -1 : 1;
  const z = AISLE_Z + 0.6 * toward;
  const edge: [number, number] = [EDGE[side], z];
  const stop: [number, number] = [bay.x + 1.2 * side, z];
  const away: [number, number] = [EDGE[(-side) as 1 | -1], z];
  const speed = b.speed();
  const s: VehicleScript = {
    id: b.next(), spec_space: 'aisle', nonce: b.r.int(0, 1_000_000), space_id: 'aisle', motion: 'pause', role: 'target', present_before: false, end: 'vanish',
    segments: [
      { kind: 'line', t0: tp - lineMs(edge, stop, speed), t1: tp, from: edge, to: stop },
      { kind: 'hold', t0: tp, t1: tp + hold, tag: { space_id: spaceId, phase: 'paused_near' } },
      { kind: 'line', t0: tp + hold, t1: tp + hold + lineMs(stop, away, speed), from: stop, to: away },
    ],
  };
  b.scripts.push(s);
  return s;
}

const inView = (p: VehiclePose | null) => p !== null && p.x >= VISIBLE_X[0] && p.x <= VISIBLE_X[1];

/** Adds background pass-bys until every frame has a vehicle that moved inside the visible lot. */
function ensureMotion(b: Builder, frames: number, interval: number): void {
  const moving = (t: number) =>
    b.scripts.some((s) => {
      const now = scriptPose(s, b.seed, t);
      const before = scriptPose(s, b.seed, t - interval);
      return inView(now) && (!before || Math.hypot(now!.x - before.x, now!.z - before.z) > 0.05 || Math.abs(now!.heading - before.heading) > 1e-3);
    });
  for (let guard = 0; guard < 6; guard++) {
    const gap = [...Array(frames).keys()].map((i) => i * interval).find((t) => !moving(t));
    if (gap === undefined) return;
    const dir: 1 | -1 = b.r.chance(0.5) ? 1 : -1;
    // Enter the visible lot just before the gap.
    const s = passBy(b, dir, 0);
    const seg = s.segments[0] as Extract<Segment, { kind: 'line' }>;
    const v = Math.abs(seg.to[0] - seg.from[0]) / (seg.t1 - seg.t0);
    const entry = dir === 1 ? VISIBLE_X[0] + 1 : VISIBLE_X[1] - 1;
    const shift = gap - Math.abs(entry - seg.from[0]) / v;
    seg.t0 += shift;
    seg.t1 += shift;
  }
  throw new Error('could not keep every frame moving');
}

// ---- plan --------------------------------------------------------------------------------

function layout(bays: readonly string[], nonce: (space: string) => number): Record<string, number> {
  const chosen = new Set(bays);
  return Object.fromEntries(SPACE_IDS.filter((id) => chosen.has(id)).map((id) => [id, nonce(id)]));
}

const rowOf = (id: string) => id.replace(/\d+$/, '');
const indexOf = (id: string) => Number(id.replace(/^\D+/, ''));
const neighbours = (id: string) => [indexOf(id) - 1, indexOf(id) + 1].filter((i) => i >= 1 && i <= 6).map((i) => `${rowOf(id)}${i}`);

export function planTemporalV2(input: TemporalV2Config): TemporalV2FramePlan[] {
  const c = validateTemporalV2Config(input);
  const g = c.seed_groups;
  const seeds = sceneSeeds(c.dataset_seed, g.reference + g.dev + g.test);
  const splits = assignV2Splits(c.dataset_seed, seeds, g);
  const splitIndex = new Map<V2Split, number>();
  const out: TemporalV2FramePlan[] = [];
  const end = (c.frames.count - 1) * c.frames.interval_ms;

  for (const seed of seeds) {
    const split = splits.get(seed)!;
    const s = splitIndex.get(split) ?? 0;
    splitIndex.set(split, s + 1);

    if (split === 'reference') {
      c.presets.forEach((preset) => {
        for (let k = 0; k < c.reference_layouts_per_preset; k++) {
          const r = rng(seed, 'temporal-v2-reference', preset, k);
          // Capture 0 is the empty lot; the others are partly occupied, so empty bays are also seen beside parked cars.
          const occupancy = k === 0 ? {} : layout(shuffled(r, SPACE_IDS).slice(0, r.int(3, 9)), () => r.int(0, 1_000_000));
          const id = `r${seed}-ref-${k}-${preset}`;
          out.push({
            sample_id: `${id}-f00`, split, subset: 'reference', group_id: `seed-${seed}`, scenario_id: id, sequence_id: id,
            family: 'reference', seed, preset, density: densityOf(Object.keys(occupancy).length), occupancy, occluders: [], scripts: [],
            pattern: null, roles: Object.fromEntries(SPACE_IDS.map((b) => [b, 'other' as BayRole])), dropout_frames: [],
            frame_index: 0, frame_count: 1, t_ms: 0, future_horizon_ms: c.future_horizon_ms, v2: true,
          });
        }
      });
      continue;
    }

    c.families.forEach((family, fi) => {
      for (let k = 0; k < c.sequences_per_seed; k++) {
        const r = rng(seed, 'temporal-v2', family, k);
        const n = { i: 0 };
        const b: Builder = { seed, r, scripts: [], speed: () => r.range(c.aisle_speed_mps[0], c.aisle_speed_mps[1]), next: () => `v${n.i++}` };
        const nonce = () => r.int(0, 1_000_000);
        const largeNonce = (space: string) => {
          for (let j = 0; j < 10_000; j++) {
            const x = hashKey(seed, 'temporal-v2-large', family, k, space, j) % 1_000_000;
            if (c.large_vehicle_kinds.includes(generateVehicle(seed, space, x).kind)) return x;
          }
          throw new Error('no large vehicle nonce found');
        };
        // Lighting rotates over seeds and sequences so every family sees every preset in each split.
        const preset = c.presets[(c.sequences_per_seed * s + k + fi) % 4]!;
        const count = (d: 'sparse' | 'medium' | 'dense') => r.int(c.density_ranges[d][0], c.density_ranges[d][1] + 1);
        const anyDensity = () => count(r.pick(['sparse', 'medium', 'dense'] as const));
        const side = (): 1 | -1 => (r.chance(0.5) ? 1 : -1);
        const id = `t${seed}-${SHORT[family]}-${k}-${preset}`;
        let occupancy: Record<string, number> = {};
        let pattern: RowPattern | null = null;
        let occluders: OccluderSpec[] = [];
        const roles: Record<string, BayRole> = Object.fromEntries(SPACE_IDS.map((x) => [x, 'other' as BayRole]));
        let dropout: number[] = [];
        const emptyBays = () => shuffled(r, SPACE_IDS.filter((x) => !(x in occupancy)));
        const fullBays = () => shuffled(r, SPACE_IDS.filter((x) => x in occupancy));
        const background = () => {
          // One background manoeuvre somewhere in the lot plus a pass-by, at random times.
          const free = emptyBays();
          const taken = fullBays();
          const t = r.range(0, 3000);
          if (taken.length && (!free.length || r.chance(0.5))) depart(b, taken[0]!, side(), t, occupancy[taken[0]!]!, 'background');
          else if (free.length) arrive(b, free[0]!, side(), t, nonce(), 'background');
          passBy(b, side(), r.range(-6000, 1000));
        };
        switch (family) {
          case 'settled_empty': passBy(b, side(), r.range(-4000, 0)); break;
          case 'settled_full': occupancy = layout(SPACE_IDS, nonce); background(); break;
          case 'settled_sparse': case 'settled_medium': case 'settled_dense': {
            const d = family.slice('settled_'.length) as 'sparse' | 'medium' | 'dense';
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, count(d)), nonce);
            background();
            break;
          }
          case 'row_pattern':
            pattern = PATTERNS[(s + k) % PATTERNS.length]!;
            occupancy = layout(ROW_PATTERNS[pattern], nonce);
            background();
            break;
          case 'occlusion_partial':
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, anyDensity()), nonce);
            occluders = [crate(r, `${id}-crate`)];
            background();
            break;
          case 'occlusion_severe':
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, anyDensity()), nonce);
            occluders = pillars(r, id);
            background();
            break;
          case 'pass_by':
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, count(r.pick(['sparse', 'medium'] as const))), nonce);
            passBy(b, side(), r.range(-5000, -1000));
            if (r.chance(0.5)) passBy(b, side(), r.range(0, 3000));
            break;
          case 'entering': case 'detector_dropout': case 'large_vehicles': case 'occluded_approach': {
            const large = family === 'large_vehicles';
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, large ? count(r.pick(['medium', 'dense'] as const)) : anyDensity()), large ? largeNonce : nonce);
            let pool = emptyBays();
            if (family === 'occluded_approach') pool = pool.filter((x) => rowOf(x) === 'A');
            if (!pool.length) {
              // Free a bay for the target arrival.
              const freed = family === 'occluded_approach' ? 'A' + r.int(1, 7) : fullBays()[0]!;
              const { [freed]: _, ...rest } = occupancy;
              occupancy = rest;
              pool = [freed];
            }
            const target = pool[0]!;
            const sd = side();
            const ta = r.range(1000, 3000);
            arrive(b, target, sd, ta, large ? largeNonce(target) : nonce(), 'target');
            roles[target] = 'target';
            for (const x of neighbours(target)) roles[x] = 'neighbor';
            if (family === 'occluded_approach') occluders = [screen(`${id}-screen`, bayById(target).x + 3.6 * sd, 11.9)];
            if (family === 'detector_dropout') {
              const f0 = Math.max(1, Math.round((ta - 500) / c.frames.interval_ms));
              dropout = [...Array(c.dropout_frames).keys()].map((i) => f0 + i).filter((i) => i < c.frames.count);
            }
            break;
          }
          case 'neighbor_approach': {
            const target = r.pick(['A', 'B'] as const) + r.int(2, 6);
            occupancy = layout(shuffled(r, SPACE_IDS.filter((x) => x !== target && !neighbours(target).includes(x))).slice(0, anyDensity()), nonce);
            arrive(b, target, side(), r.range(1000, 3000), nonce(), 'target');
            roles[target] = 'target';
            for (const x of neighbours(target)) roles[x] = 'neighbor';
            break;
          }
          case 'exiting': {
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, anyDensity()), nonce);
            const target = fullBays()[0]!;
            depart(b, target, side(), r.range(0, 1500), occupancy[target]!, 'target');
            roles[target] = 'target';
            for (const x of neighbours(target)) roles[x] = 'neighbor';
            break;
          }
          case 'aborted_approach': {
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, count(r.pick(['sparse', 'medium'] as const))), nonce);
            const target = emptyBays()[0]!;
            aborted(b, target, side(), r.range(500, 2000));
            roles[target] = 'target';
            for (const x of neighbours(target)) roles[x] = 'neighbor';
            break;
          }
          case 'pause_near': {
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, count(r.pick(['sparse', 'medium'] as const))), nonce);
            const target = emptyBays()[0]!;
            pause(b, target, side(), r.range(1500, 3000), r.range(2000, 3000));
            roles[target] = 'target';
            for (const x of neighbours(target)) roles[x] = 'neighbor';
            break;
          }
          case 'two_vehicles': {
            occupancy = layout(shuffled(r, SPACE_IDS).slice(0, count(r.pick(['sparse', 'medium'] as const))), nonce);
            const row = r.pick(['A', 'B'] as const);
            const free = emptyBays().filter((x) => rowOf(x) === row).sort((p, q) => indexOf(p) - indexOf(q));
            const [p, q] = free.length >= 2 ? [free[0]!, free[free.length - 1]!] : (emptyBays().slice(0, 2) as [string, string]);
            const [west, east] = bayById(p).x <= bayById(q).x ? [p, q] : [q, p];
            const ta = r.range(1000, 2500);
            // From opposite ends, so the two cars cross in front of each other's bays.
            arrive(b, west, 1, ta, nonce(), 'target');
            arrive(b, east, -1, ta + r.range(-400, 400), nonce(), 'target');
            roles[west] = roles[east] = 'target';
            break;
          }
        }
        ensureMotion(b, c.frames.count, c.frames.interval_ms);
        // Arriving bays must be free at the start; departing bays must hold that vehicle.
        for (const sc of b.scripts) {
          if (sc.motion === 'arrive' && sc.space_id in occupancy) throw new Error(`${id}: arrival into occupied ${sc.space_id}`);
          if (sc.motion === 'depart' && occupancy[sc.space_id] !== sc.nonce) throw new Error(`${id}: departure from empty ${sc.space_id}`);
        }
        if (end <= 0) throw new Error('empty sequence');
        for (let i = 0; i < c.frames.count; i++) {
          out.push({
            sample_id: `${id}-f${String(i).padStart(2, '0')}`, split, subset: 'temporal', group_id: `seed-${seed}`, scenario_id: id, sequence_id: id,
            family, seed, preset, density: densityOf(Object.keys(occupancy).length), occupancy, occluders, scripts: b.scripts, pattern, roles,
            dropout_frames: dropout, frame_index: i, frame_count: c.frames.count, t_ms: i * c.frames.interval_ms,
            future_horizon_ms: c.future_horizon_ms, v2: true,
          });
        }
      }
    });
  }
  const ids = new Set<string>();
  for (const f of out) {
    if (ids.has(f.sample_id)) throw new Error(`duplicate sample id ${f.sample_id}`);
    if (`tq-${f.sequence_id}`.length > 64) throw new Error(`sequence id too long for a session id: ${f.sequence_id}`);
    ids.add(f.sample_id);
  }
  return out;
}

// ---- staging -----------------------------------------------------------------------------

type Patched = World & { vehicles: World['vehicles'] };

/** Puts the frame's state into `world`: static parked vehicles from World, moving ones from scripts. */
export function stageV2(world: World, frame: TemporalV2FramePlan, camera: CameraPose, at = frame.t_ms): void {
  unstageV2(world);
  const departing = new Set(frame.scripts.filter((s) => s.motion === 'depart').map((s) => s.space_id));
  const parked = Object.fromEntries(Object.entries(frame.occupancy).filter(([id]) => !departing.has(id)));
  world.setTraffic(false);
  world.load({ seed: frame.seed, preset: frame.preset, occupancy: parked, camera });
  world.simTimeMs = at;
  const base = World.prototype.vehicles;
  (world as Patched).vehicles = function (this: World) {
    const scripted = frame.scripts.map((s) => scriptPose(s, frame.seed, at)).filter((p): p is VehiclePose => p !== null);
    return [...base.call(this), ...scripted];
  };
}

/** Restores World's own vehicles() on this instance. */
export function unstageV2(world: World): void {
  if (Object.hasOwn(world, 'vehicles')) delete (world as Partial<Patched>).vehicles;
}

/** A vehicle's ground footprint reaches into the bay while its centre is outside it. */
export function intrusions(world: World): Set<string> {
  const out = new Set<string>();
  for (const v of world.vehicles()) {
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    for (const bay of BAYS) {
      if (insideBay(bay, v.x, v.z)) continue;
      let hit = false;
      for (let i = -2; i <= 2 && !hit; i++) {
        for (let j = -1; j <= 1 && !hit; j++) {
          const lz = (i / 2) * (v.spec.length / 2);
          const lx = j * (v.spec.width / 2);
          hit = insideBay(bay, v.x + c * lx + s * lz, v.z - s * lx + c * lz);
        }
      }
      if (hit) out.add(bay.spaceId);
    }
  }
  return out;
}

/** Truth-side labels for one frame: phase, footprint intrusion and occupancy within the horizon. */
export function frameLabels(world: World, frame: TemporalV2FramePlan, camera: CameraPose) {
  const future = new Set<string>();
  for (let dt = 250; dt <= frame.future_horizon_ms; dt += 250) {
    stageV2(world, frame, camera, frame.t_ms + dt);
    for (const s of world.truth().spaces) if (s.truth === 'occupied') future.add(s.space_id);
  }
  stageV2(world, frame, camera);
  const phases = phasesAt(frame.scripts, frame.t_ms);
  const intr = intrusions(world);
  return Object.fromEntries(
    world.truth().spaces.map((s) => [
      s.space_id,
      { phase: phases[s.space_id] ?? 'settled', intrusion: intr.has(s.space_id), occupied_within_horizon: s.truth === 'empty' && future.has(s.space_id), role: frame.roles[s.space_id] ?? 'other' },
    ]),
  );
}
