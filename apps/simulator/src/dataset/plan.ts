/**
 * OFFLINE DATASET plan: config → the complete, ordered list of samples to render.
 *
 * Pure and deterministic: every choice comes from rng(dataset_seed, …) or rng(scene seed, …),
 * so the same config always yields the same sample IDs, layouts, vehicle identities and
 * splits. Vehicle appearance is the simulator's own generateVehicle(seed, space, nonce).
 *
 * Split strategy (see experiments/a2-dataset/README.md):
 *   - The split unit is the scene seed ("group"). Every layout, lighting variant,
 *     occluder and transition frame rendered from one seed lands in the same split, so
 *     near-identical frames never straddle splits.
 *   - Main seeds are ordered by hash(dataset_seed, 'split', seed) and cut into
 *     train / validation / test by the configured counts.
 *   - Robustness seeds are a separate pool, always split 'test' with subset 'robustness',
 *     and they use families (pillars, large-vehicle lots, row patterns) that never occur
 *     anywhere else.
 *   - The empty deck does not vary with seed, so it is one group of its own.
 */
import { SPACE_IDS } from '../sim/facility.ts';
import { PRESETS, type PresetId } from '../sim/presets.ts';
import { hashKey, type Rng, rng } from '../sim/prng.ts';
import { normaliseSeed } from '../sim/spec.ts';
import { generateVehicle } from '../sim/vehicles.ts';
import { type DatasetConfig, type Density, type RowPattern, validateConfig } from './config.ts';
import { crate, type OccluderSpec, pillars } from './occluders.ts';

export type Split = 'train' | 'validation' | 'test';
export type Subset = 'standard' | 'robustness';
export type Family = 'static_empty' | 'settled' | 'occlusion' | 'transition' | 'robust_pillar' | 'robust_large_vehicles' | 'robust_row_pattern';

export interface TransitionSpec {
  kind: 'arrive' | 'depart';
  space_id: string;
  nonce: number;
  progress: number;
  elapsed_ms: number;
}

export interface SamplePlan {
  sample_id: string;
  split: Split;
  subset: Subset;
  group_id: string;
  scenario_id: string;
  family: Family;
  seed: number;
  preset: PresetId;
  density: Density;
  /** Bays occupied before any transition, with the vehicle nonce in each. */
  occupancy: Record<string, number>;
  occluders: OccluderSpec[];
  transition: TransitionSpec | null;
  pattern: RowPattern | null;
}

/** Must match sim/world.ts MANOEUVRE_MS; a test pins it. */
export const MANOEUVRE_MS = 3200;

const ROW_PATTERNS: Record<RowPattern, string[]> = {
  row_a_only: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  row_b_only: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
  checkerboard: ['A1', 'A3', 'A5', 'B2', 'B4', 'B6'],
};

const SHORT: Record<Exclude<Density, 'empty'>, string> = { sparse: 'spa', medium: 'med', dense: 'den', full: 'ful' };

function shuffled<T>(r: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = r.int(0, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function densityOf(count: number): Density {
  if (count === 0) return 'empty';
  if (count === 12) return 'full';
  return count <= 3 ? 'sparse' : count <= 7 ? 'medium' : 'dense';
}

function sceneSeeds(datasetSeed: number, purpose: string, n: number, taken: Set<number>): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < n; i++) {
    const s = normaliseSeed(hashKey(datasetSeed, purpose, i) & 0x7fffffff);
    if (taken.has(s)) continue;
    taken.add(s);
    out.push(s);
  }
  return out;
}

/** Deterministic seed → split assignment. Exported so consumers can re-derive it. */
export function assignSplits(datasetSeed: number, seeds: readonly number[], counts: { train: number; validation: number; test: number }): Map<number, Split> {
  if (seeds.length !== counts.train + counts.validation + counts.test) throw new Error('split counts do not cover every seed');
  const order = [...seeds].sort((a, b) => hashKey(datasetSeed, 'split', a) - hashKey(datasetSeed, 'split', b) || a - b);
  const out = new Map<number, Split>();
  order.forEach((s, i) => out.set(s, i < counts.train ? 'train' : i < counts.train + counts.validation ? 'validation' : 'test'));
  return out;
}

function randomLayout(r: Rng, count: number, nonceOf: (space: string) => number): Record<string, number> {
  const occupancy: Record<string, number> = {};
  for (const id of shuffled(r, SPACE_IDS).slice(0, count)) occupancy[id] = nonceOf(id);
  return Object.fromEntries(SPACE_IDS.filter((id) => id in occupancy).map((id) => [id, occupancy[id]!]));
}

export function planDataset(input: DatasetConfig): SamplePlan[] {
  const config = validateConfig(input);
  const ds = config.dataset_seed;
  const taken = new Set<number>();
  const g = config.seed_groups;
  const main = sceneSeeds(ds, 'scene-seed', g.train + g.validation + g.test, taken);
  const robust = sceneSeeds(ds, 'robustness-seed', g.robustness, taken);
  const splits = assignSplits(ds, main, g);
  const samples: SamplePlan[] = [];

  const emit = (base: Omit<SamplePlan, 'sample_id' | 'preset' | 'density'>, presets: readonly PresetId[], suffix = '') => {
    const density = densityOf(Object.keys(base.occupancy).length);
    for (const preset of presets) samples.push({ ...base, sample_id: `${base.scenario_id}-${preset}${suffix}`, preset, density });
  };

  for (const preset of config.static_empty.presets) {
    samples.push({
      sample_id: `static-empty-${preset}`,
      split: config.static_empty.split,
      subset: 'standard',
      group_id: 'static-empty',
      scenario_id: 'static-empty',
      family: 'static_empty',
      seed: 0,
      preset,
      density: 'empty',
      occupancy: {},
      occluders: [],
      transition: null,
      pattern: null,
    });
  }

  for (const seed of main) {
    const split = splits.get(seed)!;
    const common = { split, subset: 'standard' as const, group_id: `seed-${seed}`, seed, occluders: [] as OccluderSpec[], transition: null, pattern: null };
    const nonce = (r: Rng) => () => r.int(0, 1_000_000);

    for (const [density, layouts] of Object.entries(config.settled.layouts) as [Exclude<Density, 'empty'>, number][]) {
      const [lo, hi] = config.density_ranges[density];
      for (let i = 0; i < layouts; i++) {
        const r = rng(seed, 'dataset-layout', density, i);
        const occupancy = randomLayout(r, r.int(lo, hi + 1), nonce(r));
        emit({ ...common, family: 'settled', scenario_id: `s${seed}-${SHORT[density]}-${i}`, occupancy }, config.settled.presets);
      }
    }

    for (let i = 0; i < config.occlusion.layouts; i++) {
      const r = rng(seed, 'dataset-occlusion', i);
      const [lo, hi] = config.density_ranges[r.pick(['sparse', 'medium', 'dense'] as const)];
      const occupancy = randomLayout(r, r.int(lo, hi + 1), nonce(r));
      const scenario_id = `s${seed}-occ-${i}`;
      emit({ ...common, family: 'occlusion', scenario_id, occupancy, occluders: [crate(r, `${scenario_id}-crate`)] }, config.occlusion.presets);
    }

    const t = config.transitions;
    for (const [kind, n] of [['arrive', t.arrivals], ['depart', t.departures]] as const) {
      for (let i = 0; i < n; i++) {
        const r = rng(seed, 'dataset-transition', kind, i);
        const [lo, hi] = config.density_ranges[r.pick(['sparse', 'medium', 'dense'] as const)];
        const occupancy = randomLayout(r, r.int(lo, hi + 1), nonce(r));
        const candidates = SPACE_IDS.filter((id) => (kind === 'arrive') !== id in occupancy);
        const space_id = r.pick(candidates);
        const moverNonce = kind === 'arrive' ? r.int(0, 1_000_000) : occupancy[space_id]!;
        const scenario_id = `s${seed}-${kind === 'arrive' ? 'arr' : 'dep'}-${i}`;
        for (const progress of t.progress) {
          const transition = { kind, space_id, nonce: moverNonce, progress, elapsed_ms: Math.round(progress * MANOEUVRE_MS) };
          emit({ ...common, family: 'transition', scenario_id, occupancy, transition }, t.presets, `-p${String(Math.round(progress * 100)).padStart(3, '0')}`);
        }
      }
    }
  }

  const rb = config.robustness;
  for (const seed of robust) {
    const common = { split: 'test' as const, subset: 'robustness' as const, group_id: `robust-${seed}`, seed, occluders: [] as OccluderSpec[], transition: null, pattern: null };
    for (let i = 0; i < rb.pillar_occlusion.layouts; i++) {
      const r = rng(seed, 'dataset-robust-pillar', i);
      const [lo, hi] = config.density_ranges[r.pick(['medium', 'dense'] as const)];
      const occupancy = randomLayout(r, r.int(lo, hi + 1), () => r.int(0, 1_000_000));
      const scenario_id = `r${seed}-pil-${i}`;
      emit({ ...common, family: 'robust_pillar', scenario_id, occupancy, occluders: pillars(r, scenario_id) }, rb.pillar_occlusion.presets);
    }
    for (let i = 0; i < rb.large_vehicles.layouts; i++) {
      const r = rng(seed, 'dataset-robust-large', i);
      const [lo, hi] = config.density_ranges[r.pick(['medium', 'dense', 'full'] as const)];
      // First nonce whose simulator-generated vehicle is one of the requested kinds.
      const largeNonce = (space: string) => {
        for (let k = 0; k < 10_000; k++) {
          const n = hashKey(seed, 'large', i, space, k) % 1_000_000;
          if (rb.large_vehicles.kinds.includes(generateVehicle(seed, space, n).kind)) return n;
        }
        throw new Error('no large vehicle nonce found');
      };
      const occupancy = randomLayout(r, r.int(lo, hi + 1), largeNonce);
      emit({ ...common, family: 'robust_large_vehicles', scenario_id: `r${seed}-lrg-${i}`, occupancy }, rb.large_vehicles.presets);
    }
    for (const pattern of rb.row_patterns.patterns) {
      const r = rng(seed, 'dataset-robust-row', pattern);
      const occupancy = Object.fromEntries(ROW_PATTERNS[pattern].map((id) => [id, r.int(0, 1_000_000)]));
      emit({ ...common, family: 'robust_row_pattern', scenario_id: `r${seed}-row-${pattern.replace(/_/g, '')}`, occupancy, pattern }, rb.row_patterns.presets);
    }
  }

  const ids = new Set<string>();
  for (const s of samples) {
    if (ids.has(s.sample_id)) throw new Error(`duplicate sample id ${s.sample_id}`);
    if (`ds-${s.sample_id}`.length > 64) throw new Error(`sample id too long for a session id: ${s.sample_id}`);
    ids.add(s.sample_id);
  }
  return samples;
}

export const environmentOf = (preset: PresetId) => PRESETS[preset].contract;
