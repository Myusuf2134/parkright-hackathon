import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { poseEuler } from '../src/camera/pose.ts';
import { parseGaragePreset } from '../src/garage/presets.ts';
import { OHIO, OHIO_BAYS, OHIO_CAMERAS, OHIO_ROWS, ohioElevation, ohioOwnedBays } from '../src/ohio/layout.ts';
import { OHIO_SCENARIO_IDS, OHIO_TRAFFIC, OHIO_VALIDATION_PARKED, ohioPassLegs } from '../src/ohio/traffic.ts';
import { buildSiteSchedule, HORIZON_MS, occupiedIn, posesAt } from '../src/showcase/schedule.ts';
import { OHIO_SITE, parseSite, SHOWCASE_SITE } from '../src/showcase/site.ts';
import { buildSchedule, occupiedAt, SHOWCASE_SCENARIO_IDS } from '../src/showcase/traffic.ts';
import { ShowcaseWorld } from '../src/showcase/world.ts';
// @ts-expect-error plain ESM analysis script
import { analyse } from '../../../experiments/ohio-union-garage/camera-search.mjs';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const dir = 'packages/shared/calibration/ohio-union/';
const facility = read(`${dir}facility.json`);
const site = read(`${dir}site.json`);
const cals = Object.fromEntries(OHIO_CAMERAS.map((c) => [c.id, read(`${dir}${c.id}.json`)]));
const schedule = (id: (typeof OHIO_SCENARIO_IDS)[number], seed = 4242) => buildSiteSchedule(OHIO_TRAFFIC, id, seed);

describe('Ohio Union-inspired layout', () => {
  it('72 bays: rows A–D of 18, bays 1–9 west of the spine and 10–18 east', () => {
    expect(OHIO_BAYS).toHaveLength(72);
    expect(OHIO_ROWS).toEqual(['A', 'B', 'C', 'D']);
    for (const row of OHIO_ROWS) {
      const bays = OHIO_BAYS.filter((b) => b.row === row);
      expect(bays.map((b) => b.id)).toEqual(Array.from({ length: 18 }, (_, i) => `${row}${i + 1}`));
      expect(bays.slice(0, 9).every((b) => b.module === 'west' && b.centre[0] < OHIO.spine.x0)).toBe(true);
      expect(bays.slice(9).every((b) => b.module === 'east' && b.centre[0] > OHIO.spine.x1)).toBe(true);
    }
    for (const b of OHIO_BAYS) {
      expect(b.corners.every((c) => c[1] === 0.025)).toBe(true);
      expect([b.width, b.depth]).toEqual([2.6, 5.4]);
    }
  });

  it('bays do not overlap and stay clear of the aisles, the spine, the turnaround and the ramp', () => {
    for (const a of OHIO_BAYS) for (const b of OHIO_BAYS) {
      if (a.id >= b.id) continue;
      const ox = Math.min(a.corners[2][0], b.corners[2][0]) - Math.max(a.corners[0][0], b.corners[0][0]);
      const oz = Math.min(a.corners[2][2], b.corners[2][2]) - Math.max(a.corners[0][2], b.corners[0][2]);
      expect(ox > 0 && oz > 0, `${a.id}/${b.id}`).toBe(false);
    }
    for (const b of OHIO_BAYS) {
      const [x0, , z0] = b.corners[0];
      const [x1, , z1] = b.corners[2];
      for (const a of [OHIO.aisle1, OHIO.aisle2]) expect(z1 <= a.z0 + 1e-9 || z0 >= a.z1 - 1e-9, `${b.id} in an aisle`).toBe(true);
      expect(x1 <= OHIO.spine.x0 || x0 >= OHIO.spine.x1, `${b.id} in the spine`).toBe(true);
      expect(x1).toBeLessThan(OHIO.loop.x0);
      expect(x0).toBeGreaterThan(OHIO.westWallX);
      expect(z0).toBeGreaterThan(OHIO.northWallZ);
      expect(z1).toBeLessThan(OHIO.walkwayZ + 1e-9);
    }
  });

  it('a low deck: girders hang to 2.9 m, cameras at 2.8 m below them, vans (2.15 m) clear', () => {
    expect(OHIO.ceiling - OHIO.girderDepth).toBeCloseTo(2.9, 6);
    for (const c of OHIO_CAMERAS) expect(c.pose.position[1]).toBeLessThan(OHIO.ceiling - OHIO.girderDepth);
    expect(OHIO.ceiling - OHIO.girderDepth).toBeGreaterThan(2.15 + 0.5);
  });

  it('ramp surface rises from the floor to level 2', () => {
    const R = OHIO.ramp;
    expect(ohioElevation(R.upLane, R.z0 - 1)).toBe(0);
    expect(ohioElevation(R.upLane, (R.z0 + R.z1) / 2)).toBeCloseTo(R.rise / 2, 6);
    expect(ohioElevation(R.downLane, R.z1 + 1)).toBeCloseTo(R.rise, 6);
    expect(ohioElevation(30, 20)).toBe(0); // the parking floor is level
    expect(R.rise).toBeCloseTo(OHIO.ceiling + 0.25, 6); // lands on the slab top
  });
});

describe('Ohio Union-inspired camera ownership', () => {
  it('eight cameras, each owning one half-row of 9; every bay owned exactly once', () => {
    expect(OHIO_CAMERAS.map((c) => c.id)).toEqual(['cam-01', 'cam-02', 'cam-03', 'cam-04', 'cam-05', 'cam-06', 'cam-07', 'cam-08']);
    const owned = OHIO_CAMERAS.flatMap((c) => ohioOwnedBays(c.id).map((b) => b.id));
    expect(owned.sort()).toEqual(OHIO_BAYS.map((b) => b.id).sort());
    expect(new Set(owned).size).toBe(72);
    for (const c of OHIO_CAMERAS) {
      const bays = ohioOwnedBays(c.id);
      expect(bays).toHaveLength(9);
      expect(bays.every((b) => b.row === c.row && b.module === c.module)).toBe(true);
      expect([c.pose.width, c.pose.height]).toEqual([1280, 720]);
    }
  });

  it('facility cameras watch only their owned bays, with exactly the calibration polygons', () => {
    expect(facility.facility_id).toBe('garage-01');
    expect(facility.is_simulated).toBe(true);
    expect(facility.name).toMatch(/Ohio Union North Garage-inspired simulation/);
    expect(facility.spaces).toHaveLength(72);
    expect(facility.cameras.map((c: { camera_id: string }) => c.camera_id)).toEqual(OHIO_CAMERAS.map((c) => c.id));
    const watched = facility.cameras.flatMap((c: { watches: string[] }) => c.watches);
    expect(new Set(watched).size).toBe(72);
    for (const c of facility.cameras) {
      expect(c.watches).toEqual(ohioOwnedBays(c.camera_id).map((b) => b.id));
      expect(c.polygons).toEqual(cals[c.camera_id].polygons);
    }
  });

  it('the site is labelled as inspired, never as an official or exact digital twin', () => {
    expect(site.site_id).toBe('ohio-union');
    expect(site.title).toBe('Ohio Union North Garage-inspired simulation');
    expect(site.disclaimer).toMatch(/Not an official or exact digital twin/);
    expect(site.disclaimer).toMatch(/no real OSU data/);
    expect([site.spaces, site.cameras]).toEqual([72, 8]);
    expect(OHIO_SITE.title).toBe(site.title);
    expect(OHIO_SITE.disclaimer).toMatch(/Not an official or exact digital twin/);
  });
});

describe('Ohio Union-inspired calibration', () => {
  it('eight calibrations, each with only its owned bays, projected from 3D corners', () => {
    for (const cam of OHIO_CAMERAS) {
      const cal = cals[cam.id];
      expect(cal.camera_id).toBe(cam.id);
      expect(cal.version).toBe(`ohio-union-v1-${cam.id}`);
      expect(cal.pose).toEqual(cam.pose);
      expect(cal.unobservable).toEqual([]);
      expect(Object.keys(cal.polygons)).toEqual(ohioOwnedBays(cam.id).map((b) => b.id));
      const c = new PerspectiveCamera(cam.pose.fov, 16 / 9, 0.1, 400);
      c.position.set(...cam.pose.position);
      c.rotation.set(...poseEuler(cam.pose), 'YXZ');
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
      for (const b of ohioOwnedBays(cam.id)) {
        b.corners.forEach((corner, i) => {
          const p = new Vector3(...corner).project(c);
          expect(cal.polygons[b.id][i].x).toBeCloseTo((p.x + 1) / 2, 6);
          expect(cal.polygons[b.id][i].y).toBeCloseTo((1 - p.y) / 2, 6);
        });
      }
    }
  });

  it('committed calibrations match the generator (drift check), and the 34-space ones are untouched', () => {
    execFileSync('node', ['scripts/generate-ohio-calibration.mjs', '--check'], { cwd: root });
    execFileSync('node', ['scripts/generate-showcase-calibration.mjs', '--check'], { cwd: root });
  });

  it('geometry: no owned-bay neighbour spill and no spill from bays the camera does not own', () => {
    for (const cam of OHIO_CAMERAS) {
      const r = analyse(cam.pose, ohioOwnedBays(cam.id));
      expect(r, cam.id).not.toBeNull();
      expect(r.risky, `${cam.id} ${r.pairs.join(' ')}`).toBe(0);
      expect(r.foreign, cam.id).toBe(0);
      expect(r.worst).toBeLessThan(0.45);
      expect(r.foreignWorst).toBeLessThan(0.45);
      expect(r.minSelf).toBeGreaterThan(0.6);
    }
  });

  it('never enables OPEN or carries thresholds', () => {
    expect(JSON.stringify(cals) + JSON.stringify(facility) + JSON.stringify(site)).not.toMatch(/allow_open|threshold|confidence/i);
  });
});

describe('Ohio Union-inspired traffic', () => {
  it('every scenario rebuilds identically, depends on the seed and differs from the others', () => {
    const seen = new Set<string>();
    for (const id of OHIO_SCENARIO_IDS) {
      const a = JSON.stringify(schedule(id).events);
      expect(JSON.stringify(buildSiteSchedule(OHIO_TRAFFIC, id, 4242).events)).toBe(a);
      if (id !== 'validation') expect(JSON.stringify(schedule(id, 7).events)).not.toBe(a);
      seen.add(a);
      for (const t of [0, 7300, 61_000, 300_000]) expect(JSON.stringify(posesAt(schedule(id), t))).toBe(JSON.stringify(posesAt(schedule(id), t)));
    }
    expect(seen.size).toBe(OHIO_SCENARIO_IDS.length);
    // Not the 34-space garage's traffic.
    expect(JSON.stringify(schedule('live').events)).not.toBe(JSON.stringify(buildSchedule('live').events));
  }, 120_000);

  it('scheduler invariants: ordered, spaced gate entries, one vehicle per bay, within 72', () => {
    for (const id of OHIO_SCENARIO_IDS) {
      const s = schedule(id);
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
        expect(held.size).toBeLessThanOrEqual(72);
      }
    }
  });

  it('scenarios behave as named and are sized for 72 bays', () => {
    const kinds = (id: (typeof OHIO_SCENARIO_IDS)[number]) => {
      const e = schedule(id).events.filter((x) => x.t < 120_000);
      return { a: e.filter((x) => x.kind === 'arrive').length, d: e.filter((x) => x.kind === 'depart').length, p: e.filter((x) => x.kind === 'pass').length };
    };
    expect(kinds('morning-rush').a).toBeGreaterThan(kinds('morning-rush').d * 3);
    expect(kinds('exiting').a).toBe(0);
    expect(kinds('entering').d).toBe(0);
    expect(kinds('pass-through').a + kinds('pass-through').d).toBe(0);
    expect(kinds('occlusion-stress').p).toBeGreaterThan(kinds('occlusion-stress').a);
    expect(schedule('nearly-full').initialOccupied).toHaveLength(66);
    expect(schedule('sparse').initialOccupied).toHaveLength(10);
    expect(schedule('live').initialOccupied).toHaveLength(38);
    expect(posesAt(schedule('live'), 30_000).some((p) => p.moving)).toBe(true);
  });

  it('routes use the spine, the east turnaround and both ramp lanes, and stay inside the site', () => {
    const xs = (route: Parameters<typeof ohioPassLegs>[0]) => ohioPassLegs(route).flatMap((l) => l.points);
    // A straight run along the lane that passes the island line (z = 18.1).
    const along = (pts: [number, number][], x: number) => pts.some((p, i) => i > 0 && Math.abs(p[0] - x) < 0.01 && Math.abs(pts[i - 1]![0] - x) < 0.01 && Math.min(p[1], pts[i - 1]![1]) < 18.1 && Math.max(p[1], pts[i - 1]![1]) > 18.1);
    expect(along(xs('spine'), OHIO.spine.lane)).toBe(true);
    expect(along(xs('loop'), OHIO.loop.lane)).toBe(true);
    expect(along(xs('loop'), OHIO.spine.lane)).toBe(false);
    expect(xs('up').at(-1)![1]).toBeGreaterThan(OHIO.ramp.z1);
    expect(ohioElevation(...xs('up').at(-1)!)).toBeCloseTo(OHIO.ramp.rise, 6);
    expect(ohioElevation(...xs('down')[0]!)).toBeCloseTo(OHIO.ramp.rise, 6);
    for (const route of ['loop', 'spine', 'up', 'down'] as const) {
      for (const [x, z] of xs(route)) {
        expect(x).toBeGreaterThanOrEqual(OHIO.westWallX - 4);
        expect(x).toBeLessThan(OHIO.eastWallX);
        expect(z).toBeGreaterThan(OHIO.northWallZ);
        expect(z).toBeLessThan(OHIO.southWallZ);
      }
    }
    // Pass-through traffic really takes all four routes, and some of it is on the ramp.
    const s = schedule('pass-through');
    const ends = new Set(s.vehicles.filter((v) => v.pass).map((v) => {
      const last = v.pass!.legs.at(-1)!.points.at(-1)!;
      const first = v.pass!.legs[0]!.points[0]!;
      return ohioElevation(...last) > 0 ? 'up' : ohioElevation(...first) > 0 ? 'down' : 'flat';
    }));
    expect(ends).toEqual(new Set(['up', 'down', 'flat']));
    let onRamp = false;
    for (let t = 0; t < 600_000 && !onRamp; t += 1000) onRamp = posesAt(s, t).some((p) => ohioElevation(p.x, p.z) > 0.5);
    expect(onRamp).toBe(true);
  });

  it('arrivals end inside their own bay, and that bay alone becomes occupied', () => {
    const s = schedule('morning-rush');
    for (const v of s.vehicles.filter((x) => x.arrival).slice(0, 40)) {
      const end = v.arrival!.legs.at(-1)!.points.at(-1)!;
      const bay = OHIO_BAYS.find((b) => b.id === v.bay)!;
      expect(Math.abs(end[0] - bay.centre[0])).toBeLessThan(0.5);
      expect(Math.abs(end[1] - bay.centre[1])).toBeLessThan(1);
    }
  });

  it('the validation scene is fixed and static, with large vehicles beside empty bays', () => {
    const s = schedule('validation');
    expect(s.events).toEqual([]);
    const parked = Object.keys(OHIO_VALIDATION_PARKED).sort();
    expect(s.initialOccupied).toEqual(parked);
    expect(occupiedIn(OHIO_BAYS, posesAt(s, 0))).toEqual(parked);
    expect(occupiedIn(OHIO_BAYS, posesAt(s, 600_000))).toEqual(parked);
    // Every camera sees both occupied and empty owned bays.
    for (const c of OHIO_CAMERAS) {
      const own = ohioOwnedBays(c.id).map((b) => b.id);
      expect(own.some((b) => parked.includes(b)), c.id).toBe(true);
      expect(own.some((b) => !parked.includes(b)), c.id).toBe(true);
    }
    for (const [big, empty] of [['B5', 'B6'], ['B14', 'B15'], ['D2', 'D3'], ['C11', 'C10']]) {
      expect(['pickup', 'van']).toContain(OHIO_VALIDATION_PARKED[big!]);
      expect(empty! in OHIO_VALIDATION_PARKED).toBe(false);
    }
  });
});

describe('sites', () => {
  it('URL selects the site; the 34-space garage stays the default', () => {
    expect(parseSite(new URLSearchParams('showcase=1&sim=garage'))).toBe(SHOWCASE_SITE);
    expect(parseSite(new URLSearchParams('showcase=1&sim=garage&site=ohio-union'))).toBe(OHIO_SITE);
    expect(parseSite(new URLSearchParams('sim=ohio-union'))).toBe(OHIO_SITE);
    expect(parseSite(new URLSearchParams('showcase=1&sim=garage&site=elsewhere'))).toBe(SHOWCASE_SITE);
    expect(OHIO_SITE.cameras).toHaveLength(8);
    expect(SHOWCASE_SITE.cameras).toHaveLength(4);
  });

  it('the Ohio world: truth covers 72 bays, owned truth is the camera half-row, presets switch', () => {
    const w = new ShowcaseWorld('live', 'clear_day', 4242, OHIO_SITE);
    expect(w.truth().spaces).toHaveLength(72);
    expect(w.truth(ohioOwnedBays('cam-06').map((b) => b.id)).spaces.map((s) => s.space_id)).toEqual(Array.from({ length: 9 }, (_, i) => `B${i + 10}`));
    for (const p of ['day', 'dusk', 'night', 'overcast']) {
      w.setPreset(parseGaragePreset(p)!);
      expect(w.truth().preset).toBe(parseGaragePreset(p));
    }
    w.load('validation');
    expect(w.truth().spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id).sort()).toEqual(Object.keys(OHIO_VALIDATION_PARKED).sort());
    // The default world is still the 34-space garage.
    expect(new ShowcaseWorld().truth().spaces).toHaveLength(34);
  });

  it('34-space fallback: schedules are byte-identical to the pre-site scheduler (fingerprint)', () => {
    const h = createHash('sha256');
    for (const id of SHOWCASE_SCENARIO_IDS) {
      const s = buildSchedule(id, 4242);
      h.update(JSON.stringify(s));
      for (let t = 0; t < HORIZON_MS; t += 7919) {
        const p = posesAt(s, t);
        h.update(JSON.stringify(p.map((v) => [v.id, v.x, v.z, v.heading, v.moving])));
        h.update(occupiedAt(p).join(','));
      }
    }
    // Recorded on feat/garage-showcase (e047926) before the scheduler became site-generic.
    expect(h.digest('hex')).toBe('aac1c245f26204f8bd8428f74629482e3f165763fc7a6916b6a2dfd32c74274b');
  }, 120_000);
});
