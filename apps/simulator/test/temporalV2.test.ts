/** OFFLINE TEMPORAL DATASET v2: scripted motion, sealed seed splits, distinct frames, scenario semantics. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../src/camera/pose.ts';
import type { DatasetConfig } from '../src/dataset/config.ts';
import { planDataset } from '../src/dataset/plan.ts';
import { planTemporal, type TemporalConfig } from '../src/dataset/temporal.ts';
import { frameLabels, planTemporalV2, scriptPose, stageV2, type TemporalV2Config, type TemporalV2FramePlan, unstageV2, VISIBLE_X } from '../src/dataset/temporalV2.ts';
import { BAYS, insideBay } from '../src/sim/facility.ts';
import { World } from '../src/sim/world.ts';

const ROOT = join(import.meta.dirname, '../../..');
const read = <T>(p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;
const config = read<TemporalV2Config>('experiments/a2-bay-tracking/configs/a2-temporal-v2.json');
const plan = planTemporalV2(config);
const sequences = new Map<string, TemporalV2FramePlan[]>();
for (const f of plan) sequences.set(f.sequence_id, [...(sequences.get(f.sequence_id) ?? []), f]);
const temporal = plan.filter((f) => f.subset === 'temporal');

const snapshot = (world: World) => JSON.stringify(world.vehicles().map((v) => [v.key, v.x.toFixed(4), v.z.toFixed(4), v.heading.toFixed(4)]));

describe('temporal v2 plan', () => {
  it('is deterministic and independent of Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      expect(planTemporalV2(config)).toEqual(plan);
    } finally {
      Math.random = original;
    }
  });

  it('has 72 sequences of 16 ordered frames per split and 12 reference captures', () => {
    for (const split of ['dev', 'test'] as const) {
      const seqs = [...sequences.values()].filter((s) => s[0]!.split === split);
      expect(seqs).toHaveLength(72);
      for (const frames of seqs) expect(frames.map((f) => f.frame_index)).toEqual([...Array(16).keys()]);
    }
    const refs = plan.filter((f) => f.split === 'reference');
    expect(refs).toHaveLength(12);
    expect(refs.every((f) => f.subset === 'reference' && f.scripts.length === 0)).toBe(true);
    expect(new Set(refs.map((f) => f.preset)).size).toBe(4);
  });

  it('keeps seeds disjoint across splits and from every earlier dataset', () => {
    const bySeed = new Map<number, Set<string>>();
    for (const f of plan) bySeed.set(f.seed, (bySeed.get(f.seed) ?? new Set()).add(f.split));
    for (const s of bySeed.values()) expect(s.size).toBe(1);
    const v1 = planTemporal(read<TemporalConfig>('experiments/a2-open-evidence/configs/a2-temporal-v1.json'));
    const sim = planDataset(read<DatasetConfig>('experiments/a2-dataset/configs/a2-sim-v1.json'));
    const earlier = new Set([...v1.map((f) => f.seed), ...sim.map((f) => f.seed)]);
    for (const s of bySeed.keys()) expect(earlier.has(s), `seed ${s}`).toBe(false);
  });

  it('covers every family in every environment in both splits', () => {
    for (const split of ['dev', 'test']) {
      for (const family of config.families) {
        const presets = new Set(temporal.filter((f) => f.split === split && f.family === family).map((f) => f.preset));
        expect(presets.size, `${split} ${family}`).toBe(4);
      }
    }
  });

  it('keeps a vehicle moving inside the visible lot in every frame, so consecutive frames differ', () => {
    const world = new World();
    for (const frames of [...sequences.values()].filter((s) => s[0]!.subset === 'temporal')) {
      const f0 = frames[0]!;
      for (const f of frames) {
        const moving = f0.scripts.some((s) => {
          const now = scriptPose(s, f0.seed, f.t_ms);
          const before = scriptPose(s, f0.seed, f.t_ms - config.frames.interval_ms);
          return now && now.x >= VISIBLE_X[0] && now.x <= VISIBLE_X[1] && (!before || now.x !== before.x || now.z !== before.z || now.heading !== before.heading);
        });
        expect(moving, f.sample_id).toBe(true);
      }
      const states = frames.filter((_, i) => i % 3 === 0 || i === 1).map((f) => {
        stageV2(world, f, DEFAULT_POSE);
        return snapshot(world);
      });
      expect(new Set(states).size, f0.sequence_id).toBe(states.length);
    }
    unstageV2(world);
  });

  it('only arriving vehicles ever have their centre inside a bay they were not parked in', () => {
    for (const frames of sequences.values()) {
      const f0 = frames[0]!;
      for (const s of f0.scripts.filter((x) => x.motion === 'pass_by' || x.motion === 'pause' || x.motion === 'aborted')) {
        for (let t = -2000; t <= 9000; t += 100) {
          const p = scriptPose(s, f0.seed, t);
          if (p) expect(BAYS.some((b) => insideBay(b, p.x, p.z)), `${f0.sequence_id} ${s.id} @${t}`).toBe(false);
        }
      }
    }
  });

  it('labels scenario phases: aborted approach, pause, entering, exiting', () => {
    const world = new World();
    const phasesOf = (family: string) => {
      const frames = [...sequences.values()].find((s) => s[0]!.family === family && s[0]!.split === 'dev')!;
      const target = Object.entries(frames[0]!.roles).find(([, r]) => r === 'target')![0];
      return { target, labels: frames.map((f) => frameLabels(world, f, DEFAULT_POSE)[target]!) };
    };
    const ab = phasesOf('aborted_approach');
    expect(ab.labels.map((l) => l.phase)).toContain('approaching');
    expect(ab.labels.map((l) => l.phase)).toContain('aborting');
    expect(ab.labels.some((l) => l.occupied_within_horizon)).toBe(false);
    expect(phasesOf('pause_near').labels.map((l) => l.phase)).toContain('paused_near');
    const ent = phasesOf('entering');
    expect(ent.labels.map((l) => l.phase)).toContain('entering');
    expect(ent.labels.some((l) => l.occupied_within_horizon)).toBe(true);
    expect(phasesOf('exiting').labels.map((l) => l.phase)).toContain('exiting');
    unstageV2(world);
  });

  it('marks neighbours and targets, blanks only designated frames, and staging is reversible', () => {
    const nb = temporal.filter((f) => f.family === 'neighbor_approach');
    for (const f of nb) {
      const target = Object.entries(f.roles).find(([, r]) => r === 'target')![0];
      for (const [id, role] of Object.entries(f.roles)) if (role === 'neighbor') expect(id in f.occupancy, `${f.sample_id} ${id}`).toBe(false);
      expect(target in f.occupancy).toBe(false);
    }
    expect(temporal.filter((f) => f.dropout_frames.length).every((f) => f.family === 'detector_dropout' && f.dropout_frames.length === 2)).toBe(true);
    const world = new World();
    stageV2(world, temporal[0]!, DEFAULT_POSE);
    expect(Object.hasOwn(world, 'vehicles')).toBe(true);
    unstageV2(world);
    expect(Object.hasOwn(world, 'vehicles')).toBe(false);
  });

  it('rejects sequences shorter than ten frames', () => {
    expect(() => planTemporalV2({ ...config, frames: { count: 8, interval_ms: 500 } })).toThrow(/at least 10 frames/);
  });
});
