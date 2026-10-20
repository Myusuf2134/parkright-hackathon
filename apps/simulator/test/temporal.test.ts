/** OFFLINE TEMPORAL DATASET: real scene progression per sequence, sealed seed splits, determinism. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE } from '../src/camera/pose.ts';
import { planTemporal, stageSequence, type TemporalConfig, type TemporalFramePlan } from '../src/dataset/temporal.ts';
import { World } from '../src/sim/world.ts';

const ROOT = join(import.meta.dirname, '../../..');
const config = JSON.parse(readFileSync(join(ROOT, 'experiments/a2-open-evidence/configs/a2-temporal-v1.json'), 'utf8')) as TemporalConfig;
const plan = planTemporal(config);
const sequences = new Map<string, TemporalFramePlan[]>();
for (const f of plan) sequences.set(f.sequence_id, [...(sequences.get(f.sequence_id) ?? []), f]);

const snapshot = (world: World) => JSON.stringify(world.vehicles().map((v) => [v.key, v.x.toFixed(4), v.z.toFixed(4), v.heading.toFixed(4)]));

describe('temporal plan', () => {
  it('is deterministic and independent of Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      expect(planTemporal(config)).toEqual(plan);
    } finally {
      Math.random = original;
    }
  });

  it('has 192 sequences of 10 strictly ordered frames', () => {
    expect(plan).toHaveLength(1920);
    expect(sequences.size).toBe(192);
    for (const frames of sequences.values()) {
      expect(frames.map((f) => f.frame_index)).toEqual([...Array(10).keys()]);
      for (let i = 1; i < frames.length; i++) expect(frames[i]!.t_ms).toBeGreaterThan(frames[i - 1]!.t_ms);
    }
  });

  it('keeps each seed in one split and covers every environment per split', () => {
    const bySeed = new Map<number, Set<string>>();
    for (const f of plan) bySeed.set(f.seed, (bySeed.get(f.seed) ?? new Set()).add(f.split));
    for (const s of bySeed.values()) expect(s.size).toBe(1);
    for (const split of ['dev', 'test']) {
      for (const family of new Set(plan.map((f) => f.family))) {
        const presets = new Set(plan.filter((f) => f.split === split && f.family === family).map((f) => f.preset));
        expect(presets.size, `${split} ${family}`).toBe(4);
      }
    }
  });

  it('rejects sequences shorter than five frames', () => {
    expect(() => planTemporal({ ...config, frames: { count: 4, interval_ms: 500 } })).toThrow(/at least 5 frames/);
  });

  it('every consecutive frame is a different scene state', () => {
    const world = new World();
    for (const frames of [...sequences.values()].filter((_, i) => i % 7 === 0)) {
      const states = frames.map((f) => {
        stageSequence(world, f, DEFAULT_POSE);
        return snapshot(world);
      });
      for (let i = 1; i < states.length; i++) expect(states[i], `${frames[i]!.sample_id}`).not.toBe(states[i - 1]);
    }
  });

  it('target transitions really enter and leave their bay', () => {
    const world = new World();
    for (const frames of [...sequences.values()].filter((f) => f[0]!.family === 'entering' || f[0]!.family === 'exiting').slice(0, 6)) {
      const target = frames[0]!.events.find((e) => e.role === 'target')!;
      const truthAt = (f: TemporalFramePlan) => {
        stageSequence(world, f, DEFAULT_POSE);
        return world.truth().spaces.find((s) => s.space_id === target.space_id)!.truth;
      };
      const [start, end] = [truthAt(frames[0]!), truthAt(frames.at(-1)!)];
      expect([start, end]).toEqual(target.kind === 'arrive' ? ['empty', 'occupied'] : ['occupied', 'empty']);
    }
  });
});
