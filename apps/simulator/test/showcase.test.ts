import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { poseEuler } from '../src/camera/pose.ts';
import { parseGaragePreset } from '../src/garage/presets.ts';
import { SHOWCASE_BAYS, SHOWCASE_CAMERAS, ownedBays } from '../src/showcase/layout.ts';
import { buildSchedule, HORIZON_MS, occupiedAt, posesAt, SHOWCASE_SCENARIO_IDS, VALIDATION_PARKED } from '../src/showcase/traffic.ts';
import { ShowcaseWorld } from '../src/showcase/world.ts';
// @ts-expect-error plain ESM analysis script
import { analyse } from '../../../experiments/garage-showcase/camera-search.mjs';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const dir = 'packages/shared/calibration/garage-showcase/';
const facility = read(`${dir}facility.json`);
const cals = Object.fromEntries(SHOWCASE_CAMERAS.map((c) => [c.id, read(`${dir}${c.id}.json`)]));

describe('34-space layout', () => {
  it('has exactly 34 bays in rows of 9 / 8 / 8 / 9', () => {
    expect(SHOWCASE_BAYS).toHaveLength(34);
    const count = (r: string) => SHOWCASE_BAYS.filter((b) => b.row === r).length;
    expect([count('A'), count('B'), count('C'), count('D')]).toEqual([9, 8, 8, 9]);
    expect(SHOWCASE_BAYS.map((b) => b.id)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `A${i}`), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `B${i}`),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `C${i}`), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `D${i}`),
    ]);
    for (const b of SHOWCASE_BAYS) expect(b.corners.every((c) => c[1] === 0.025)).toBe(true);
  });

  it('bays do not overlap', () => {
    for (const a of SHOWCASE_BAYS) for (const b of SHOWCASE_BAYS) {
      if (a.id >= b.id) continue;
      const ox = Math.min(a.corners[2][0], b.corners[2][0]) - Math.max(a.corners[0][0], b.corners[0][0]);
      const oz = Math.min(a.corners[2][2], b.corners[2][2]) - Math.max(a.corners[0][2], b.corners[0][2]);
      expect(ox > 0 && oz > 0, `${a.id}/${b.id}`).toBe(false);
    }
  });
});

describe('camera ownership', () => {
  it('four cameras, each owning one row; every bay owned exactly once', () => {
    expect(SHOWCASE_CAMERAS.map((c) => [c.id, c.row])).toEqual([['cam-01', 'A'], ['cam-02', 'B'], ['cam-03', 'C'], ['cam-04', 'D']]);
    const owned = SHOWCASE_CAMERAS.flatMap((c) => ownedBays(c.id).map((b) => b.id));
    expect(owned.sort()).toEqual(SHOWCASE_BAYS.map((b) => b.id).sort());
    expect(new Set(owned).size).toBe(34);
    for (const c of SHOWCASE_CAMERAS) expect(ownedBays(c.id).every((b) => b.row === c.row)).toBe(true);
    for (const c of SHOWCASE_CAMERAS) expect([c.pose.width, c.pose.height]).toEqual([1280, 720]);
  });

  it('facility cameras watch only their owned bays, with exactly the calibration polygons', () => {
    expect(facility.spaces).toHaveLength(34);
    expect(facility.cameras.map((c: { camera_id: string }) => c.camera_id)).toEqual(['cam-01', 'cam-02', 'cam-03', 'cam-04']);
    const watched = facility.cameras.flatMap((c: { watches: string[] }) => c.watches);
    expect(new Set(watched).size).toBe(34);
    for (const c of facility.cameras) {
      expect(c.watches).toEqual(ownedBays(c.camera_id).map((b) => b.id));
      expect(c.polygons).toEqual(cals[c.camera_id].polygons);
    }
  });
});

describe('per-camera calibration', () => {
  it('four calibrations, each with only its owned bays, projected from 3D corners', () => {
    for (const cam of SHOWCASE_CAMERAS) {
      const cal = cals[cam.id];
      expect(cal.camera_id).toBe(cam.id);
      expect(cal.pose).toEqual(cam.pose);
      expect(cal.unobservable).toEqual([]);
      expect(Object.keys(cal.polygons)).toEqual(ownedBays(cam.id).map((b) => b.id));
      const c = new PerspectiveCamera(cam.pose.fov, 16 / 9, 0.1, 400);
      c.position.set(...cam.pose.position);
      c.rotation.set(...poseEuler(cam.pose), 'YXZ');
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
      for (const b of ownedBays(cam.id)) {
        b.corners.forEach((corner, i) => {
          const p = new Vector3(...corner).project(c);
          expect(cal.polygons[b.id][i].x).toBeCloseTo((p.x + 1) / 2, 6);
          expect(cal.polygons[b.id][i].y).toBeCloseTo((1 - p.y) / 2, 6);
        });
      }
    }
  });

  it('committed calibrations match the generator (drift check)', () => {
    execFileSync('node', ['scripts/generate-showcase-calibration.mjs', '--check'], { cwd: root });
  });

  it('geometry: no owned-bay neighbour spill and no spill from other rows (B6-style regression)', () => {
    for (const cam of SHOWCASE_CAMERAS) {
      const r = analyse(cam.pose, ownedBays(cam.id));
      expect(r, cam.id).not.toBeNull();
      expect(r.risky, `${cam.id} ${r.pairs.join(' ')}`).toBe(0);
      expect(r.foreign, cam.id).toBe(0);
      expect(r.worst).toBeLessThan(0.45);
      expect(r.minSelf).toBeGreaterThan(0.6);
    }
  });

  it('never enables OPEN', () => {
    expect(JSON.stringify(cals) + JSON.stringify(facility)).not.toMatch(/allow_open|threshold|confidence/i);
  });
});

describe('deterministic traffic', () => {
  it('every scenario rebuilds identically and differs from the others', () => {
    const seen = new Set<string>();
    for (const id of SHOWCASE_SCENARIO_IDS) {
      const a = JSON.stringify(buildSchedule(id, 4242).events);
      // A different seed gives different traffic; the same seed the same.
      expect(JSON.stringify(buildSchedule(id, 4242).events)).toBe(a);
      if (id !== 'validation') expect(JSON.stringify(buildSchedule(id, 7).events)).not.toBe(a);
      seen.add(a);
      const s = buildSchedule(id);
      for (const t of [0, 7300, 61_000, 300_000]) expect(JSON.stringify(posesAt(s, t))).toBe(JSON.stringify(posesAt(buildSchedule(id), t)));
    }
    expect(seen.size).toBe(SHOWCASE_SCENARIO_IDS.length);
  }, 120_000);

  it('scheduler invariants: ordered, spaced entries, one vehicle per bay, within capacity', () => {
    for (const id of SHOWCASE_SCENARIO_IDS) {
      const s = buildSchedule(id);
      for (let i = 1; i < s.events.length; i++) expect(s.events[i]!.t).toBeGreaterThanOrEqual(s.events[i - 1]!.t);
      const entries = s.events.filter((e) => e.kind !== 'depart').map((e) => e.t);
      for (let i = 1; i < entries.length; i++) expect(entries[i]! - entries[i - 1]!).toBeGreaterThanOrEqual(4500 - 1e-6);
      expect(s.events.every((e) => e.t < HORIZON_MS)).toBe(true);
      const held = new Set(s.initialOccupied);
      for (const e of s.events) {
        if (e.kind === 'arrive') {
          expect(held.has(e.bay!), `${id}: ${e.bay} targeted twice`).toBe(false);
          held.add(e.bay!);
        } else if (e.kind === 'depart') {
          expect(held.has(e.bay!)).toBe(true);
          held.delete(e.bay!);
        }
        expect(held.size).toBeLessThanOrEqual(34);
      }
    }
  });

  it('scenarios behave as named', () => {
    // First two minutes, before a filling garage forces departures.
    const kinds = (id: (typeof SHOWCASE_SCENARIO_IDS)[number]) => {
      const e = buildSchedule(id).events.filter((x) => x.t < 120_000);
      return { a: e.filter((x) => x.kind === 'arrive').length, d: e.filter((x) => x.kind === 'depart').length, p: e.filter((x) => x.kind === 'pass').length };
    };
    expect(kinds('morning-rush').a).toBeGreaterThan(kinds('morning-rush').d * 3);
    expect(kinds('exiting').a).toBe(0);
    expect(kinds('entering').d).toBeLessThan(kinds('entering').a);
    expect(kinds('pass-through').a + kinds('pass-through').d).toBe(0);
    expect(kinds('occlusion-stress').p).toBeGreaterThan(kinds('occlusion-stress').a);
    expect(buildSchedule('nearly-full').initialOccupied).toHaveLength(31);
    expect(buildSchedule('sparse').initialOccupied).toHaveLength(5);
    expect(occupiedAt(posesAt(buildSchedule('live'), 60_000)).length).toBeGreaterThan(0);
    // Cars really move in the live garage.
    expect(posesAt(buildSchedule('live'), 30_000).some((p) => p.moving)).toBe(true);
  });

  it('the validation scene is fixed and static', () => {
    const s = buildSchedule('validation');
    expect(s.events).toEqual([]);
    expect(s.initialOccupied).toEqual(Object.keys(VALIDATION_PARKED).sort());
    expect(occupiedAt(posesAt(s, 0))).toEqual(Object.keys(VALIDATION_PARKED).sort());
    expect(occupiedAt(posesAt(s, 600_000))).toEqual(Object.keys(VALIDATION_PARKED).sort());
    // The B6-style case: B5 occupied by a pickup with B6 empty beside it.
    expect(VALIDATION_PARKED.B5).toBe('pickup');
    expect('B6' in VALIDATION_PARKED).toBe(false);
  });
});

describe('showcase world', () => {
  it('scenario switching, lighting switching, reset and owned-bay truth', () => {
    const w = new ShowcaseWorld('live', 'clear_day');
    expect(w.playing).toBe(true);
    w.setTime(45_000);
    const before = w.epoch;
    w.load('class-transition');
    expect(w.simTimeMs).toBe(0);
    expect(w.epoch).toBeGreaterThan(before);
    expect(w.spec.scenario).toBe('class-transition');
    for (const p of ['day', 'dusk', 'night', 'overcast']) {
      w.setPreset(parseGaragePreset(p)!);
      expect(w.truth().preset).toBe(parseGaragePreset(p));
    }
    const t = w.truth(ownedBays('cam-02').map((b) => b.id));
    expect(t.spaces.map((s) => s.space_id)).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
    w.setTime(10_000);
    const e = w.epoch;
    w.reset();
    expect(w.simTimeMs).toBe(0);
    expect(w.epoch).toBe(e + 1);
  });
});
