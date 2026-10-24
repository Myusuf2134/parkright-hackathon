import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { poseEuler } from '../src/camera/pose.ts';
import { GARAGE_BAYS, GARAGE_CAM01_POSE, GARAGE_CAMERA_ID, garageBay } from '../src/garage/layout.ts';
import { GARAGE_PRESET_IDS, GARAGE_PRESETS, parseGaragePreset } from '../src/garage/presets.ts';
import { buildScenario, isScenarioId, occupiedBays, parkedPose, posesAt, routeEndMs, SCENARIO_IDS } from '../src/garage/scenarios.ts';
import { GarageWorld } from '../src/garage/world.ts';
import { PRESETS } from '../src/sim/presets.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const fixture = read('packages/shared/fixtures/mvp-facility.json');
const calibration = read('packages/shared/calibration/garage/cam-01.json');
const facility = read('packages/shared/calibration/garage/facility.json');

const sample = (id: (typeof SCENARIO_IDS)[number]) => {
  const s = buildScenario(id);
  const out = [];
  for (let t = 0; t <= s.durationMs; t += 250) out.push(posesAt(s, t).map((p) => [p.id, p.x, p.z, p.heading]));
  return out;
};

describe('garage bays', () => {
  it('are the canonical facility bays as explicit 3D geometry', () => {
    expect(GARAGE_BAYS.map((b) => b.id)).toEqual(fixture.spaces.map((s: { space_id: string }) => s.space_id));
    for (const s of fixture.spaces) {
      const b = garageBay(s.space_id);
      const [x0, , z0] = b.corners[0];
      const [x1, , z1] = b.corners[2];
      expect([x0, z0, x1, z1].map((v) => +v.toFixed(6))).toEqual(
        [s.plan.x * 20, s.plan.y * 20, (s.plan.x + s.plan.w) * 20, (s.plan.y + s.plan.h) * 20].map((v) => +v.toFixed(6)),
      );
      expect(b.corners.every((c) => c[1] === 0.025)).toBe(true);
      expect(b.row).toBe(s.space_id[0]);
      expect(b.level).toBe('L1');
    }
  });
});

describe('scenarios', () => {
  it('cover every required case and are selectable by name', () => {
    expect([...SCENARIO_IDS]).toEqual(['static', 'entering', 'exiting', 'pass-by', 'crossing', 'neighbor-approach', 'fast-approach', 'occlusion', 'full-garage', 'sparse-garage']);
    expect(isScenarioId('crossing')).toBe(true);
    expect(isScenarioId('autopilot')).toBe(false);
  });

  it('start from exact, seeded poses', () => {
    const s = buildScenario('static');
    expect(s.seed).toBe(4242);
    expect(s.parked.map((p) => p.bay)).toEqual(['A1', 'A3', 'B2', 'B5']);
    const poses = s.parked.map(parkedPose);
    expect(poses.map((p) => p.spec.kind)).toEqual(buildScenario('static').parked.map((p) => parkedPose(p).spec.kind));
    for (const p of poses) {
      const bay = garageBay(p.id.replace('parked-', ''));
      expect(Math.abs(p.x - bay.centre[0])).toBeLessThan(0.25);
      expect(Math.abs(p.z - bay.centre[1])).toBeLessThan(0.6);
    }
    expect(JSON.stringify(poses)).toBe(JSON.stringify(buildScenario('static').parked.map(parkedPose)));
  });

  it('routes are exactly reproducible', () => {
    for (const id of SCENARIO_IDS) expect(JSON.stringify(sample(id))).toBe(JSON.stringify(sample(id)));
  });

  it('every scenario ends with exactly its expected occupied bays', () => {
    for (const id of SCENARIO_IDS) {
      const s = buildScenario(id);
      for (const m of s.movers) expect(routeEndMs(m), `${id}/${m.id} finishes in time`).toBeLessThanOrEqual(s.durationMs);
      expect(occupiedBays(posesAt(s, s.durationMs)), id).toEqual(s.occupiedAtEnd);
    }
  });

  it('movers really move: entering parks in A5, exiting frees B5, pass-by leaves', () => {
    const entering = buildScenario('entering');
    expect(occupiedBays(posesAt(entering, 0))).toEqual(['A1', 'B2']);
    expect(occupiedBays(posesAt(entering, entering.durationMs))).toEqual(['A1', 'A5', 'B2']);
    const exiting = buildScenario('exiting');
    expect(occupiedBays(posesAt(exiting, 0))).toContain('B5');
    expect(occupiedBays(posesAt(exiting, exiting.durationMs))).not.toContain('B5');
    const pass = buildScenario('pass-by');
    expect(posesAt(pass, 0)).toHaveLength(4);
    expect(posesAt(pass, 6000).some((p) => p.moving)).toBe(true);
    expect(posesAt(pass, pass.durationMs)).toHaveLength(4);
  });

  it('the two crossing vehicles pass each other in the aisle', () => {
    const s = buildScenario('crossing');
    const gaps = [];
    for (let t = 0; t <= s.durationMs; t += 100) {
      const p = posesAt(s, t);
      const e = p.find((v) => v.id === 'east');
      const w = p.find((v) => v.id === 'west');
      if (e && w) gaps.push(e.x - w.x);
    }
    expect(gaps.some((g) => g < 0)).toBe(true);
    expect(gaps.some((g) => g > 0)).toBe(true);
  });
});

describe('garage world', () => {
  it('reset returns to the exact starting state', () => {
    const w = new GarageWorld('entering');
    const start = JSON.stringify(w.vehicles());
    w.play();
    for (let i = 0; i < 40; i++) w.advance(200);
    expect(JSON.stringify(w.vehicles())).not.toBe(start);
    w.reset();
    expect(w.simTimeMs).toBe(0);
    expect(JSON.stringify(w.vehicles())).toBe(start);
    expect(JSON.stringify(new GarageWorld('entering').vehicles())).toBe(start);
  });

  it('switching scenarios restarts time and changes the vehicles', () => {
    const w = new GarageWorld('static');
    w.setTime(5000);
    w.load('crossing');
    expect(w.simTimeMs).toBe(0);
    expect(w.spec.scenario).toBe('crossing');
    w.setTime(5000);
    expect(w.vehicles().some((v) => v.moving)).toBe(true);
    w.load('full-garage');
    expect(w.truth().spaces.filter((s) => s.truth === 'occupied')).toHaveLength(12);
  });

  it('truth carries scenario, poses and time, and covers every bay', () => {
    const w = new GarageWorld('occlusion', 'night');
    w.setTime(6000);
    const t = w.truth();
    expect(t.scenario).toBe('occlusion');
    expect(t.preset).toBe('night');
    expect(t.simTimeMs).toBe(6000);
    expect(t.spaces.map((s) => s.space_id)).toEqual(GARAGE_BAYS.map((b) => b.id));
    expect(t.vehicles.length).toBeGreaterThan(4);
  });

  it('uses the CAM-01 pose and camera id the calibration was made for', () => {
    expect(new GarageWorld().spec.camera).toEqual(GARAGE_CAM01_POSE);
    expect(GARAGE_CAMERA_ID).toBe('cam-01');
    expect(calibration.camera_id).toBe('cam-01');
    expect(calibration.pose).toEqual(GARAGE_CAM01_POSE);
    expect(facility.cameras.map((c: { camera_id: string }) => c.camera_id)).toEqual(['cam-01']);
  });
});

describe('lighting presets', () => {
  it('day, dusk and night (and overcast) load, with the legacy preset ids', () => {
    for (const name of ['day', 'dusk', 'night', 'overcast']) expect(parseGaragePreset(name)).not.toBeNull();
    expect(parseGaragePreset('day')).toBe('clear_day');
    expect(parseGaragePreset('noon')).toBeNull();
    expect([...GARAGE_PRESET_IDS].sort()).toEqual(Object.keys(PRESETS).sort());
    for (const id of GARAGE_PRESET_IDS) {
      const p = GARAGE_PRESETS[id];
      expect(p.fixtures.intensity).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
    }
    expect(GARAGE_PRESETS.night.sun.intensity).toBeLessThan(GARAGE_PRESETS.clear_day.sun.intensity);
    expect(GARAGE_PRESETS.night.fixtures.intensity).toBeGreaterThan(GARAGE_PRESETS.clear_day.fixtures.intensity);
  });
});

describe('automatic calibration', () => {
  const camera = new PerspectiveCamera(GARAGE_CAM01_POSE.fov, 16 / 9, 0.1, 400);
  camera.position.set(...GARAGE_CAM01_POSE.position);
  camera.rotation.set(...poseEuler(GARAGE_CAM01_POSE), 'YXZ');
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  it('polygons are the 3D bay corners projected through CAM-01', () => {
    for (const bay of GARAGE_BAYS) {
      const expected = bay.corners.map((c) => new Vector3(...c).project(camera)).map((p) => ({ x: (p.x + 1) / 2, y: (1 - p.y) / 2 }));
      calibration.polygons[bay.id].forEach((pt: { x: number; y: number }, i: number) => {
        expect(pt.x).toBeCloseTo(expected[i]!.x, 6);
        expect(pt.y).toBeCloseTo(expected[i]!.y, 6);
      });
    }
  });

  it('all twelve bays are observable, inside the image, and non-degenerate', () => {
    expect(calibration.unobservable).toEqual([]);
    expect(Object.keys(calibration.polygons)).toEqual(GARAGE_BAYS.map((b) => b.id));
    expect(calibration.image).toEqual({ width: 1280, height: 720 });
    for (const pts of Object.values(calibration.polygons) as { x: number; y: number }[][]) {
      expect(pts).toHaveLength(4);
      for (const p of pts) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1);
      }
      let area = 0;
      for (let i = 0; i < 4; i++) area += pts[i]!.x * pts[(i + 1) % 4]!.y - pts[(i + 1) % 4]!.x * pts[i]!.y;
      expect(Math.abs(area / 2) * 1280 * 720).toBeGreaterThan(1500);
    }
  });

  it('the committed calibration matches the generator, and the facility uses the same polygons', () => {
    execFileSync('node', ['scripts/generate-garage-calibration.mjs', '--check'], { cwd: root });
    expect(facility.cameras[0].polygons).toEqual(calibration.polygons);
    expect(facility.spaces).toEqual(fixture.spaces);
    expect(facility.facility_id).toBe(fixture.facility_id);
  });

  it('never enables OPEN: the calibration carries no thresholds, and garage code never mentions allow_open', () => {
    const text = JSON.stringify(calibration) + JSON.stringify(facility);
    expect(text).not.toMatch(/allow_open|threshold|confidence/i);
    for (const f of ['layout.ts', 'scenarios.ts', 'world.ts', 'scene.ts', 'lab.ts', 'GarageApp.tsx', 'boot.tsx', 'presets.ts', 'vehicles.ts']) {
      expect(readFileSync(new URL(`../src/garage/${f}`, import.meta.url), 'utf8')).not.toMatch(/allow_open|OPEN_ENABLED/);
    }
  });
});
