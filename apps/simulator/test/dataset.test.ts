/**
 * OFFLINE DATASET: determinism, split isolation, label geometry, and the boundary that
 * keeps dataset code (and its ground truth) away from the production frame path.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import calibration from '../../../packages/shared/calibration/cam-01.json';
import { DEFAULT_POSE } from '../src/camera/pose.ts';
import type { DatasetConfig } from '../src/dataset/config.ts';
import { cameraFor, occluderLabels, stageWorld, vehicleLabels } from '../src/dataset/labels.ts';
import { assignSplits, MANOEUVRE_MS as PLAN_MANOEUVRE_MS, planDataset, type SamplePlan } from '../src/dataset/plan.ts';
import { occlusionOf } from '../src/dataset/raster.ts';
import { BAYS } from '../src/sim/facility.ts';
import { MANOEUVRE_MS, World } from '../src/sim/world.ts';

const ROOT = join(import.meta.dirname, '../../..');
const v1 = JSON.parse(readFileSync(join(ROOT, 'experiments/a2-dataset/configs/a2-sim-v1.json'), 'utf8')) as DatasetConfig;
const smoke = JSON.parse(readFileSync(join(ROOT, 'experiments/a2-dataset/configs/a2-sim-smoke.json'), 'utf8')) as DatasetConfig;
const plan = planDataset(v1);
const camera = cameraFor(DEFAULT_POSE);

describe('dataset plan', () => {
  it('is deterministic and independent of Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      expect(planDataset(v1)).toEqual(plan);
    } finally {
      Math.random = original;
    }
  });

  it('has the documented size and unique, contract-valid sample ids', () => {
    expect(plan).toHaveLength(1284);
    expect(new Set(plan.map((s) => s.sample_id)).size).toBe(plan.length);
    for (const s of plan) expect(`ds-${s.sample_id}`).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  });

  it('keeps every seed, group, scenario and layout inside one split', () => {
    for (const key of ['seed', 'group_id', 'scenario_id'] as const) {
      const splits = new Map<unknown, Set<string>>();
      for (const s of plan) splits.set(s[key], (splits.get(s[key]) ?? new Set()).add(s.split));
      for (const v of splits.values()) expect(v.size).toBe(1);
    }
  });

  it('isolates the robustness subset', () => {
    const robust = plan.filter((s) => s.subset === 'robustness');
    const standardSeeds = new Set(plan.filter((s) => s.subset === 'standard').map((s) => s.seed));
    expect(robust.length).toBe(80);
    for (const s of robust) {
      expect(s.split).toBe('test');
      expect(standardSeeds.has(s.seed)).toBe(false);
      expect(s.family.startsWith('robust_')).toBe(true);
    }
    expect(plan.filter((s) => s.subset === 'standard' && s.family.startsWith('robust_'))).toHaveLength(0);
    // Large-vehicle lots really are made of the requested kinds.
    const world = new World();
    for (const s of robust.filter((x) => x.family === 'robust_large_vehicles')) {
      stageWorld(world, s, DEFAULT_POSE);
      for (const v of world.vehicles()) expect(['pickup', 'van']).toContain(v.spec.kind);
    }
  });

  it('assigns splits by seed with exact counts', () => {
    const seeds = [5, 9, 1, 44, 3];
    const a = assignSplits(1, seeds, { train: 3, validation: 1, test: 1 });
    expect([...a.values()].filter((s) => s === 'train')).toHaveLength(3);
    expect(assignSplits(1, [...seeds].reverse(), { train: 3, validation: 1, test: 1 })).toEqual(a);
  });

  it('uses the simulator manoeuvre duration', () => {
    expect(PLAN_MANOEUVRE_MS).toBe(MANOEUVRE_MS);
  });

  it('rejects unsupported environments', () => {
    expect(() => planDataset({ ...smoke, settled: { ...smoke.settled, presets: ['rain' as never] } })).toThrow(/unsupported environment/);
  });
});

describe('dataset labels', () => {
  it('uses the calibrated cam-01 projection', () => {
    expect(calibration.pose).toEqual(DEFAULT_POSE);
    for (const bay of BAYS) {
      const p = new Vector3(bay.x - bay.width / 2, 0.025, bay.z - bay.depth / 2).project(camera);
      const c = calibration.polygons[bay.spaceId as keyof typeof calibration.polygons][0]!;
      expect((p.x + 1) / 2).toBeCloseTo(c.x, 6);
      expect((1 - p.y) / 2).toBeCloseTo(c.y, 6);
    }
  });

  it('projects every vehicle of a full lot inside the image', () => {
    const full = plan.find((s) => s.density === 'full' && s.family === 'settled')!;
    const world = new World();
    stageWorld(world, full, DEFAULT_POSE);
    const labels = vehicleLabels(world, camera, DEFAULT_POSE);
    expect(labels).toHaveLength(12);
    for (const l of labels) {
      const [x0, y0, x1, y1] = l.bbox_amodal!;
      expect(0 <= x0 && x0 < x1 && x1 <= 1280 && 0 <= y0 && y0 < y1 && y1 <= 720).toBe(true);
      expect(l.instance_id).toBe(`${l.space_id}:${full.occupancy[l.space_id]}`);
    }
  });

  it('stages transitions mid-manoeuvre and is reproducible', () => {
    const t = plan.find((s): s is SamplePlan & { transition: NonNullable<SamplePlan['transition']> } => s.transition?.kind === 'arrive')!;
    const a = new World();
    const b = new World();
    stageWorld(a, t, DEFAULT_POSE);
    stageWorld(b, t, DEFAULT_POSE);
    const mover = a.vehicles().find((v) => v.spaceId === t.transition.space_id)!;
    expect(mover.phase).toBe('arriving');
    expect(a.simTimeMs).toBe(t.transition.elapsed_ms);
    expect(vehicleLabels(a, camera, DEFAULT_POSE)).toEqual(vehicleLabels(b, camera, DEFAULT_POSE));
  });

  it('places occluders inside the frame', () => {
    for (const s of plan.filter((x) => x.occluders.length)) for (const o of occluderLabels(s.occluders, camera, DEFAULT_POSE)) expect(o.bbox_amodal).not.toBeNull();
  });

  it('classifies occlusion levels', () => {
    expect(occlusionOf(1, 100)).toBe('none');
    expect(occlusionOf(0.6, 60)).toBe('partial');
    expect(occlusionOf(0.1, 10)).toBe('heavy');
    expect(occlusionOf(0, 0)).toBe('hidden');
  });
});

describe('dataset isolation from production frames', () => {
  const src = join(import.meta.dirname, '../src');
  const read = (dir: string) => readdirSync(join(src, dir)).map((f) => [f, readFileSync(join(src, dir, f), 'utf8')] as const);

  it('dataset code never imports the frame path or talks to the network', () => {
    for (const [file, text] of read('dataset')) {
      expect(text, file).not.toMatch(/from ['"]\.\.\/stream\//);
      expect(text, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(text, file).not.toMatch(/groundTruth\.ts|postGroundTruth/);
    }
  });

  it('the frame path and the operator app never import dataset code', () => {
    for (const [file, text] of [...read('stream'), ['main.tsx', readFileSync(join(src, 'main.tsx'), 'utf8')] as const]) expect(text, file).not.toMatch(/dataset\//);
    expect(readFileSync(join(import.meta.dirname, '../index.html'), 'utf8')).not.toMatch(/dataset/);
  });
});
