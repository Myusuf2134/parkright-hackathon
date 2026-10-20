/**
 * OFFLINE TEMPORAL DATASET plan: sequences of consecutive frames for OPEN-evidence evaluation.
 *
 * Every sequence is one scene (seed, layout, lighting, occluders) observed at N equally spaced
 * simulator times. Two staggered real manoeuvres (park/remove through World) run during every
 * sequence, so consecutive frames show actual scene progression, never the same state twice.
 * A sequence is either a target transition (a vehicle entering or leaving a bay) or a settled
 * scene whose target bays do not change while background vehicles move.
 *
 * Splits: the unit is the scene seed. Seeds are ordered by hash(dataset_seed, 'split', seed)
 * and cut into dev / test by count. TEST is sealed: see experiments/a2-open-evidence/README.md.
 * Pure and deterministic; Math.random is never used.
 */
import type { CameraPose } from '../camera/pose.ts';
import { SPACE_IDS } from '../sim/facility.ts';
import { isPresetId, type PresetId } from '../sim/presets.ts';
import { hashKey, type Rng, rng } from '../sim/prng.ts';
import { normaliseSeed } from '../sim/spec.ts';
import { generateVehicle } from '../sim/vehicles.ts';
import { MANOEUVRE_MS, type World } from '../sim/world.ts';
import type { Density, RowPattern } from './config.ts';
import { crate, type OccluderSpec, pillars } from './occluders.ts';
import { densityOf } from './plan.ts';

export const TEMPORAL_SCHEMA = 'parkright-temporal-dataset-v1';

export type TemporalSplit = 'dev' | 'test';
export type TemporalFamily =
  | 'settled_empty' | 'settled_sparse' | 'settled_medium' | 'settled_dense' | 'settled_full'
  | 'entering' | 'exiting' | 'occlusion_partial' | 'occlusion_severe' | 'large_vehicles' | 'row_pattern';
export const TEMPORAL_FAMILIES: readonly TemporalFamily[] = [
  'settled_empty', 'settled_sparse', 'settled_medium', 'settled_dense', 'settled_full',
  'entering', 'exiting', 'occlusion_partial', 'occlusion_severe', 'large_vehicles', 'row_pattern',
];

export interface TemporalConfig {
  kind: 'temporal';
  name: string;
  dataset_seed: number;
  seed_groups: { dev: number; test: number };
  frames: { count: number; interval_ms: number };
  /** Sim time (ms, from sequence start) at which the first and second manoeuvres begin. */
  event_offsets_ms: [number, number];
  density_ranges: Record<'sparse' | 'medium' | 'dense', [number, number]>;
  presets: PresetId[];
  /** Sequences per scene seed for each family. */
  families: Record<TemporalFamily, number>;
  large_vehicle_kinds: string[];
}

export interface TemporalEvent {
  t_ms: number;
  kind: 'arrive' | 'depart';
  space_id: string;
  nonce: number;
  role: 'target' | 'background';
}

export interface TemporalFramePlan {
  sample_id: string;
  split: TemporalSplit;
  subset: 'temporal';
  group_id: string;
  scenario_id: string;
  sequence_id: string;
  family: TemporalFamily;
  seed: number;
  preset: PresetId;
  density: Density;
  /** Bays occupied at sequence start, with the vehicle nonce in each. */
  occupancy: Record<string, number>;
  occluders: OccluderSpec[];
  events: TemporalEvent[];
  pattern: RowPattern | null;
  frame_index: number;
  frame_count: number;
  t_ms: number;
  transition: null;
}

const ROW_PATTERNS: Record<RowPattern, string[]> = {
  row_a_only: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  row_b_only: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
  checkerboard: ['A1', 'A3', 'A5', 'B2', 'B4', 'B6'],
};
const PATTERNS = Object.keys(ROW_PATTERNS) as RowPattern[];
const SHORT: Record<TemporalFamily, string> = {
  settled_empty: 'emp', settled_sparse: 'spa', settled_medium: 'med', settled_dense: 'den', settled_full: 'ful',
  entering: 'ent', exiting: 'exi', occlusion_partial: 'ocp', occlusion_severe: 'ocs', large_vehicles: 'lrg', row_pattern: 'row',
};

export function validateTemporalConfig(c: TemporalConfig): TemporalConfig {
  const fail = (msg: string) => {
    throw new Error(`invalid temporal config: ${msg}`);
  };
  if (c.kind !== 'temporal') fail('kind must be "temporal"');
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(c.name)) fail('name must be a short lowercase slug');
  if (!Number.isInteger(c.dataset_seed) || c.dataset_seed < 0) fail('dataset_seed');
  if (!(c.seed_groups.dev >= 1 && c.seed_groups.test >= 1)) fail('dev and test need at least one seed each');
  if (!(Number.isInteger(c.frames.count) && c.frames.count >= 5)) fail('a sequence needs at least 5 frames');
  if (!(c.frames.interval_ms > 0)) fail('interval_ms');
  const [a, b] = c.event_offsets_ms;
  const end = (c.frames.count - 1) * c.frames.interval_ms;
  // Some manoeuvre must be in progress strictly after the first frame and through the last one.
  if (!(a >= 0 && a < c.frames.interval_ms && b > a && b < a + MANOEUVRE_MS && b + MANOEUVRE_MS > end)) fail('event offsets must keep the scene moving across every frame');
  for (const p of c.presets) if (!isPresetId(p)) fail(`unsupported environment preset ${p}`);
  if (c.presets.length !== 4) fail('all four presets are required');
  for (const f of TEMPORAL_FAMILIES) if (!(Number.isInteger(c.families[f]) && c.families[f] >= 0)) fail(`families.${f}`);
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
    const s = normaliseSeed(hashKey(datasetSeed, 'temporal-scene-seed', i) & 0x7fffffff);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function assignTemporalSplits(datasetSeed: number, seeds: readonly number[], dev: number): Map<number, TemporalSplit> {
  const order = [...seeds].sort((a, b) => hashKey(datasetSeed, 'split', a) - hashKey(datasetSeed, 'split', b) || a - b);
  return new Map(order.map((s, i) => [s, i < dev ? 'dev' : 'test']));
}

function layout(r: Rng, bays: readonly string[], nonce: (space: string) => number): Record<string, number> {
  const chosen = new Set(bays);
  return Object.fromEntries(SPACE_IDS.filter((id) => chosen.has(id)).map((id) => [id, nonce(id)]));
}

export function planTemporal(input: TemporalConfig): TemporalFramePlan[] {
  const c = validateTemporalConfig(input);
  const seeds = sceneSeeds(c.dataset_seed, c.seed_groups.dev + c.seed_groups.test);
  const splits = assignTemporalSplits(c.dataset_seed, seeds, c.seed_groups.dev);
  const splitIndex = new Map<TemporalSplit, number>();
  const out: TemporalFramePlan[] = [];
  const [first, second] = c.event_offsets_ms;

  for (const seed of seeds) {
    const split = splits.get(seed)!;
    const s = splitIndex.get(split) ?? 0;
    splitIndex.set(split, s + 1);
    TEMPORAL_FAMILIES.forEach((family, fi) => {
      for (let k = 0; k < c.families[family]; k++) {
        const r = rng(seed, 'temporal', family, k);
        const nonce = () => r.int(0, 1_000_000);
        const largeNonce = (space: string) => {
          for (let j = 0; j < 10_000; j++) {
            const n = hashKey(seed, 'temporal-large', k, space, j) % 1_000_000;
            if (c.large_vehicle_kinds.includes(generateVehicle(seed, space, n).kind)) return n;
          }
          throw new Error('no large vehicle nonce found');
        };
        // Lighting rotates over seeds and sequences so each family sees every preset per split.
        const preset = c.presets[(s + k + fi) % 4]!;
        const count = (d: 'sparse' | 'medium' | 'dense') => r.int(c.density_ranges[d][0], c.density_ranges[d][1] + 1);
        let occupancy: Record<string, number> = {};
        let pattern: RowPattern | null = null;
        let occluders: OccluderSpec[] = [];
        const id = `t${seed}-${SHORT[family]}-${k}-${preset}`;
        switch (family) {
          case 'settled_empty': break;
          case 'settled_full': occupancy = layout(r, SPACE_IDS, nonce); break;
          case 'settled_sparse': case 'settled_medium': case 'settled_dense': {
            const d = family.slice('settled_'.length) as 'sparse' | 'medium' | 'dense';
            occupancy = layout(r, shuffled(r, SPACE_IDS).slice(0, count(d)), nonce);
            break;
          }
          case 'large_vehicles':
            occupancy = layout(r, shuffled(r, SPACE_IDS).slice(0, count(r.pick(['medium', 'dense'] as const))), largeNonce);
            break;
          case 'row_pattern':
            pattern = PATTERNS[(s + k) % PATTERNS.length]!;
            occupancy = layout(r, ROW_PATTERNS[pattern], nonce);
            break;
          default:
            occupancy = layout(r, shuffled(r, SPACE_IDS).slice(0, count(r.pick(['sparse', 'medium', 'dense'] as const))), nonce);
        }
        if (family === 'occlusion_partial') occluders = [crate(r, `${id}-crate`)];
        if (family === 'occlusion_severe') occluders = pillars(r, id);

        // Events: the first starts just after frame 0, the second keeps the scene moving to the end.
        const empty = shuffled(r, SPACE_IDS.filter((b) => !(b in occupancy)));
        const full = shuffled(r, SPACE_IDS.filter((b) => b in occupancy));
        const nonceFor = family === 'large_vehicles' ? largeNonce : () => r.int(0, 1_000_000);
        const take = (kind: 'arrive' | 'depart', t_ms: number, role: TemporalEvent['role']): TemporalEvent | null => {
          const pool = kind === 'arrive' ? empty : full;
          const space_id = pool.shift();
          if (!space_id) return null;
          return { t_ms, kind, space_id, nonce: kind === 'arrive' ? nonceFor(space_id) : occupancy[space_id]!, role };
        };
        const firstKind: 'arrive' | 'depart' = family === 'exiting' || family === 'settled_full' ? 'depart' : family === 'entering' || family === 'settled_empty' ? 'arrive' : r.pick(['arrive', 'depart'] as const);
        const role = family === 'entering' || family === 'exiting' ? 'target' : 'background';
        const e1 = take(firstKind, first, role) ?? take(firstKind === 'arrive' ? 'depart' : 'arrive', first, role);
        const secondKind: 'arrive' | 'depart' = family === 'settled_full' ? 'depart' : family === 'settled_empty' ? 'arrive' : firstKind === 'arrive' ? 'depart' : 'arrive';
        const e2 = take(secondKind, second, 'background') ?? take(secondKind === 'arrive' ? 'depart' : 'arrive', second, 'background');
        if (!e1 || !e2) throw new Error(`${id}: cannot schedule two manoeuvres`);
        const events = [e1, e2];
        for (let i = 0; i < c.frames.count; i++) {
          out.push({
            sample_id: `${id}-f${String(i).padStart(2, '0')}`,
            split,
            subset: 'temporal',
            group_id: `seed-${seed}`,
            scenario_id: id,
            sequence_id: id,
            family,
            seed,
            preset,
            density: densityOf(Object.keys(occupancy).length),
            occupancy,
            occluders,
            events,
            pattern,
            frame_index: i,
            frame_count: c.frames.count,
            t_ms: i * c.frames.interval_ms,
            transition: null,
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

/** Plays the sequence's manoeuvres through the real World up to this frame's time. */
export function stageSequence(world: World, frame: TemporalFramePlan, camera: CameraPose): void {
  world.setTraffic(false);
  world.load({ seed: frame.seed, preset: frame.preset, occupancy: frame.occupancy, camera });
  world.play();
  let now = 0;
  const to = (t: number) => {
    for (; now < t; now = Math.min(t, now + 250)) world.advance(Math.min(250, t - now));
  };
  for (const e of [...frame.events].sort((a, b) => a.t_ms - b.t_ms)) {
    if (e.t_ms > frame.t_ms) break;
    to(e.t_ms);
    if (e.kind === 'arrive') world.park(e.space_id, e.nonce);
    else world.remove(e.space_id);
  }
  to(frame.t_ms);
  world.pause();
}
