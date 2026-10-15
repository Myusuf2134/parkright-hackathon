/**
 * Ground truth must never reach a perception frame. These tests pin the boundaries.
 * The browser test (e2e/) checks the same thing on the actual wire.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { toGroundTruthRecord } from '../src/evaluation/groundTruth.ts';
import { OPERATOR_LAYER } from '../src/scene/layers.ts';
import { OperatorOverlays } from '../src/scene/overlays.ts';
import { World } from '../src/sim/world.ts';
import { assertCanonicalMetadata, buildFrameForm, FRAME_FILENAME } from '../src/stream/frameUpload.ts';

const META = { session_id: 'sim-1', camera_id: 'cam-01', seq: 3, sim_time_ms: 1500, captured_at: '2026-10-14T12:00:00.000Z' };
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], { type: 'image/jpeg' });

describe('frame metadata', () => {
  it('accepts exactly the canonical five fields', () => {
    expect(() => assertCanonicalMetadata(META)).not.toThrow();
  });

  it.each([
    ['occupancy', { occupancy: { A1: 'occupied' } }],
    ['ground truth', { ground_truth: [] }],
    ['vehicle positions', { vehicles: [[1, 2]] }],
    ['labels', { labels: ['A1'] }],
    ['object ids', { object_ids: ['A1:0'] }],
    ['debug', { debug: true }],
  ])('rejects %s', (_, extra) => {
    expect(() => assertCanonicalMetadata({ ...META, ...extra })).toThrow(/exactly/);
  });

  it.each([
    { seq: -1 },
    { seq: 1.5 },
    { sim_time_ms: '10' },
    { camera_id: '../cam' },
    { session_id: 'has space' },
    { captured_at: '2026-10-14 12:00' },
  ])('rejects invalid values %j', (bad) => {
    expect(() => assertCanonicalMetadata({ ...META, ...bad })).toThrow();
  });
});

describe('frame form', () => {
  it('has exactly two parts: canonical metadata JSON and a content-free JPEG file', async () => {
    const form = buildFrameForm(META, JPEG);
    expect([...form.keys()]).toEqual(['metadata', 'image']);
    expect(Object.keys(JSON.parse(form.get('metadata') as string))).toEqual(['session_id', 'camera_id', 'seq', 'sim_time_ms', 'captured_at']);
    const image = form.get('image') as File;
    expect(image.name).toBe(FRAME_FILENAME);
    expect(image.type).toBe('image/jpeg');
  });

  it('refuses a smuggled field even when the type system is bypassed', () => {
    const sneaky = { ...META, spaces: [{ space_id: 'A1', truth: 'occupied' }] } as unknown as typeof META;
    expect(() => buildFrameForm(sneaky, JPEG)).toThrow();
  });

  it('refuses non-JPEG data', () => {
    expect(() => buildFrameForm(META, new Blob(['x'], { type: 'image/png' }))).toThrow(/image\/jpeg/);
  });
});

describe('ground truth', () => {
  it('is a separate contract record for the same frame', () => {
    const w = new World();
    w.park('A1');
    const record = toGroundTruthRecord(META, w.truth());
    expect(record).toMatchObject({ session_id: 'sim-1', camera_id: 'cam-01', seq: 3, environment_preset: 'clear_day' });
    expect(record.spaces.find((s) => s.space_id === 'A1')?.truth).toBe('occupied');
    expect(record.spaces.filter((s) => s.truth === 'occupied')).toHaveLength(1);
  });
});

describe('operator overlays', () => {
  it('live entirely on the operator layer, which cam-01 does not render', () => {
    const cam01 = new PerspectiveCamera();
    const overlays = new OperatorOverlays(cam01);
    let count = 0;
    overlays.root.traverse((o) => {
      count++;
      expect(o.layers.mask, o.type).toBe(1 << OPERATOR_LAYER);
    });
    expect(count).toBeGreaterThan(12);
    expect(cam01.layers.test(overlays.root.layers)).toBe(false);
  });
});

// ---- source boundaries -------------------------------------------------------------------

const SRC = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
const code = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');

describe('source boundaries', () => {
  it('the frame uploader imports nothing but the contracts', () => {
    expect(importsOf(join(SRC, 'stream/frameUpload.ts'))).toEqual(['@parkright/contracts']);
  });

  it('cam-01 knows nothing about the simulation or evaluation', () => {
    for (const i of importsOf(join(SRC, 'camera/virtualCamera.ts'))) expect(i).not.toMatch(/sim\/|evaluation|stream/);
  });

  it.each(files(join(SRC, 'sim')).concat(files(join(SRC, 'scene'))).map((f) => [relative(SRC, f), f]))(
    '%s is deterministic and stays out of networking',
    (_, file) => {
      const src = code(file);
      expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
      for (const i of importsOf(file)) expect(i).not.toMatch(/stream\/|evaluation\//);
    },
  );
});
