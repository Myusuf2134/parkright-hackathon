import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE, poseEuler, RESOLUTIONS } from '../src/camera/pose.ts';
import { BAYS, CAMERA_ID, FACILITY, SPACE_IDS } from '../src/sim/facility.ts';
import { PRESET_IDS, PRESETS } from '../src/sim/presets.ts';
import { rng } from '../src/sim/prng.ts';
import { decodeSpec, defaultSpec, encodeSpec } from '../src/sim/spec.ts';
import { generateVehicle } from '../src/sim/vehicles.ts';
import { MANOEUVRE_MS, World } from '../src/sim/world.ts';

const occupied = (w: World) => w.truth().spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id);

describe('facility', () => {
  it('uses the canonical fixture ids', () => {
    expect(FACILITY.facility_id).toBe('garage-01');
    expect(CAMERA_ID).toBe('cam-01');
    expect(SPACE_IDS).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  });

  it('lays bays out at real-world scale without overlap', () => {
    for (const b of BAYS) {
      expect(b.width).toBeCloseTo(2.6);
      expect(b.depth).toBeCloseTo(6);
    }
    expect(BAYS.filter((b) => b.row === 'A').every((b) => b.opensTo === 1)).toBe(true);
    expect(BAYS.filter((b) => b.row === 'B').every((b) => b.opensTo === -1)).toBe(true);
  });
});

describe('determinism', () => {
  it('rng depends only on its key', () => {
    const a = rng(7, 'x', 1);
    const b = rng(7, 'x', 1);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    expect(rng(7, 'x', 2).next()).not.toBe(rng(7, 'x', 1).next());
  });

  it('vehicles are a pure function of seed, space and nonce', () => {
    expect(generateVehicle(42, 'A1', 0)).toEqual(generateVehicle(42, 'A1', 0));
    const fleet = SPACE_IDS.flatMap((id) => [0, 1, 2, 3].map((n) => generateVehicle(42, id, n)));
    expect(new Set(fleet.map((v) => v.kind)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(fleet.map((v) => v.color)).size).toBeGreaterThanOrEqual(6);
  });

  it('the n-th randomize for a seed is always the same layout', () => {
    const a = new World({ ...defaultSpec(), seed: 99 });
    const b = new World({ ...defaultSpec(), seed: 99 });
    a.randomize();
    b.randomize();
    expect(a.spec.occupancy).toEqual(b.spec.occupancy);
    a.randomize();
    expect(a.spec.occupancy).not.toEqual(b.spec.occupancy);
  });

  it('seeded traffic replays identically, independent of frame rate', () => {
    const run = (dt: number) => {
      const w = new World({ ...defaultSpec(), seed: 5 });
      w.setTraffic(true);
      w.play();
      for (let t = 0; t < 60_000; t += dt) w.advance(dt);
      return w.spec.occupancy;
    };
    expect(run(16)).toEqual(run(50));
    expect(Object.keys(run(16)).length).toBeGreaterThan(0);
  });

  it('a spec round-trips through the URL and rebuilds the same scene', () => {
    const w = new World({ ...defaultSpec(), seed: 1234, preset: 'night' });
    w.randomize();
    const copy = new World(decodeSpec(encodeSpec(w.spec)));
    expect(copy.spec).toEqual(w.spec);
    expect(copy.vehicles()).toEqual(w.vehicles());
  });

  it('ignores invalid URL input', () => {
    const spec = decodeSpec('seed=abc&env=lava&occ=Z9.1,A1.x,B2.3&cam=1,2');
    expect(spec.preset).toBe('clear_day');
    expect(spec.occupancy).toEqual({ B2: 3 });
    expect(spec.camera).toEqual(DEFAULT_POSE);
  });
});

describe('ground truth', () => {
  it('starts empty and follows parking when paused', () => {
    const w = new World();
    expect(occupied(w)).toEqual([]);
    w.park('A1');
    expect(occupied(w)).toEqual(['A1']);
    w.fillAll();
    expect(occupied(w)).toHaveLength(12);
    w.clearAll();
    expect(occupied(w)).toEqual([]);
  });

  it('follows the vehicle while it pulls in and out', () => {
    const w = new World();
    w.play();
    w.park('B3');
    expect(occupied(w)).toEqual([]); // still in the aisle
    for (let t = 0; t < MANOEUVRE_MS + 200; t += 100) w.advance(100);
    expect(occupied(w)).toEqual(['B3']);
    w.remove('B3');
    expect(occupied(w)).toEqual(['B3']); // still in the bay
    for (let t = 0; t < MANOEUVRE_MS + 200; t += 100) w.advance(100);
    expect(occupied(w)).toEqual([]);
  });

  it('pause freezes sim time; step advances it', () => {
    const w = new World();
    w.advance(1000);
    expect(w.simTimeMs).toBe(0);
    w.step();
    expect(w.simTimeMs).toBe(500);
    w.play();
    w.setSpeed(4);
    w.advance(100);
    expect(w.simTimeMs).toBe(900);
  });
});

describe('cam-01 default pose', () => {
  it('sees every corner of all 12 bays, with margin', () => {
    const cam = new PerspectiveCamera(DEFAULT_POSE.fov, DEFAULT_POSE.width / DEFAULT_POSE.height, 0.1, 500);
    cam.position.set(...DEFAULT_POSE.position);
    cam.rotation.set(...poseEuler(DEFAULT_POSE), 'YXZ');
    cam.updateMatrixWorld();
    for (const b of BAYS) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const p = new Vector3(b.x + (dx * b.width) / 2, 0, b.z + (dz * b.depth) / 2).project(cam);
        expect(Math.abs(p.x), `${b.spaceId} x`).toBeLessThan(0.95);
        expect(Math.abs(p.y), `${b.spaceId} y`).toBeLessThan(0.95);
        expect(p.z).toBeLessThan(1);
      }
    }
  });

  it('defaults to a supported resolution', () => {
    expect(RESOLUTIONS.some(([w, h]) => w === DEFAULT_POSE.width && h === DEFAULT_POSE.height)).toBe(true);
  });
});

describe('presets', () => {
  it('cover the required conditions and map to the canonical contract', () => {
    expect(PRESET_IDS).toEqual(['clear_day', 'overcast', 'dusk', 'night']);
    for (const id of PRESET_IDS) expect(PRESETS[id].contract.preset_id).toBe(id);
  });
});
