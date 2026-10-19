/**
 * OFFLINE DATASET configuration. A config fully determines the logical dataset (scenarios,
 * layouts, vehicle identities, splits); see plan.ts. Nothing in src/dataset is used by the
 * production frame path (src/stream), and nothing here ever builds a camera frame request.
 */
import { isPresetId, type PresetId } from '../sim/presets.ts';

export const DATASET_SCHEMA = 'parkright-dataset-v1';

export type Density = 'empty' | 'sparse' | 'medium' | 'dense' | 'full';
export const DENSITIES: readonly Density[] = ['empty', 'sparse', 'medium', 'dense', 'full'];

export type RowPattern = 'row_a_only' | 'row_b_only' | 'checkerboard';

export interface DatasetConfig {
  name: string;
  /** Root of every random choice in the plan. */
  dataset_seed: number;
  /** Scene-seed groups per split. A seed and everything rendered from it stays in one split. */
  seed_groups: { train: number; validation: number; test: number; robustness: number };
  /** Occupied-bay count range per density bucket, inclusive. */
  density_ranges: Record<Exclude<Density, 'empty'>, [number, number]>;
  /** Per scene seed: settled layouts per density, each rendered under every preset. */
  settled: { layouts: Partial<Record<Exclude<Density, 'empty'>, number>>; presets: PresetId[] };
  /** Per scene seed: layouts with a crate standing in the aisle (see occluders.ts). */
  occlusion: { layouts: number; presets: PresetId[] };
  /** Per scene seed: arrival and departure manoeuvres captured mid-way. */
  transitions: { arrivals: number; departures: number; progress: number[]; presets: PresetId[] };
  /** The empty deck renders identically for every seed, so it exists once per preset. */
  static_empty: { split: 'train' | 'validation' | 'test'; presets: PresetId[] };
  /** Held-out families that never occur in train/validation/standard test. */
  robustness: {
    pillar_occlusion: { layouts: number; presets: PresetId[] };
    large_vehicles: { layouts: number; kinds: string[]; presets: PresetId[] };
    row_patterns: { patterns: RowPattern[]; presets: PresetId[] };
  };
}

export function validateConfig(c: DatasetConfig): DatasetConfig {
  const fail = (msg: string) => {
    throw new Error(`invalid dataset config: ${msg}`);
  };
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(c.name)) fail('name must be a short lowercase slug');
  if (!Number.isInteger(c.dataset_seed) || c.dataset_seed < 0) fail('dataset_seed must be a non-negative integer');
  for (const [k, v] of Object.entries(c.seed_groups)) if (!Number.isInteger(v) || v < 0) fail(`seed_groups.${k}`);
  for (const [k, [lo, hi]] of Object.entries(c.density_ranges)) if (!(lo >= 1 && hi <= 12 && lo <= hi)) fail(`density_ranges.${k}`);
  const presets = [
    c.settled.presets,
    c.occlusion.presets,
    c.transitions.presets,
    c.static_empty.presets,
    c.robustness.pillar_occlusion.presets,
    c.robustness.large_vehicles.presets,
    c.robustness.row_patterns.presets,
  ].flat();
  for (const p of presets) if (!isPresetId(p)) fail(`unsupported environment preset ${p}`);
  for (const p of c.transitions.progress) if (!(p > 0 && p < 1)) fail('transition progress must be in (0, 1)');
  return c;
}
