// Chooses each CCTV camera's pose by the production mapper's rule: a bay is OCCUPIED when a
// vehicle box covers >= 45% of its polygon. A reference SUV (4.85 x 1.95 x 1.75 m) parked in each
// owned bay is projected to its 2D box; a "risky pair" is an owned bay whose box covers >= 45% of
// ANOTHER owned bay (a guaranteed neighbour false positive even for a perfect detector). Bays a
// camera does not own are never evaluated from that camera, so spill onto them is harmless.
//   node camera-search.mjs            evaluate the poses in layout.ts
//   node camera-search.mjs --search   search poses per camera
import { PerspectiveCamera, Vector3 } from 'three';
import { SHOWCASE_BAYS, SHOWCASE_CAMERAS, ownedBays } from '../../apps/simulator/src/showcase/layout.ts';

const DEG = Math.PI / 180;
const CAR = { l: 4.85, w: 1.95, h: 1.75 };
const toPx = (v) => [((v.x + 1) / 2) * 1280, ((1 - v.y) / 2) * 720];

function clip(poly, [x0, y0, x1, y1]) {
  const E = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]], [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]]];
  let out = poly;
  for (const [inside, cut] of E) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };

export function analyse(pose, bays) {
  const c = new PerspectiveCamera(pose.fov, 16 / 9, 0.1, 400);
  c.position.set(...pose.position);
  c.rotation.set(pose.pitch * DEG, pose.yaw * DEG, 0, 'YXZ');
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  const polys = {};
  for (const b of bays) {
    const pts = b.corners.map((q) => new Vector3(...q).project(c));
    if (pts.some((q) => q.z > 1 || Math.abs(q.x) > 0.97 || Math.abs(q.y) > 0.95)) return null;
    polys[b.id] = pts.map(toPx);
  }
  let worst = 0, risky = 0, minArea = Infinity, minSelf = 1;
  const pairs = [];
  for (const b of bays) {
    minArea = Math.min(minArea, area(polys[b.id]));
    const corners = [];
    for (const dx of [-CAR.w / 2, CAR.w / 2]) for (const dz of [-CAR.l / 2, CAR.l / 2]) for (const y of [0, CAR.h]) corners.push(toPx(new Vector3(b.centre[0] + dx, y, b.centre[1] + dz).project(c)));
    const box = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
    minSelf = Math.min(minSelf, area(clip(polys[b.id], box)) / area(polys[b.id]));
    for (const o of bays) {
      if (o.id === b.id) continue;
      const cov = area(clip(polys[o.id], box)) / area(polys[o.id]);
      if (cov >= 0.45) { risky++; pairs.push(`${b.id}→${o.id}:${cov.toFixed(2)}`); }
      worst = Math.max(worst, cov);
    }
  }
  // Cars parked in bays this camera does not own (full garage): may they cover an owned bay?
  let foreign = 0, foreignWorst = 0;
  const others = SHOWCASE_BAYS.filter((b) => !bays.some((o) => o.id === b.id));
  for (const b of others) {
    const corners = [];
    let behind = false;
    for (const dx of [-CAR.w / 2, CAR.w / 2]) for (const dz of [-CAR.l / 2, CAR.l / 2]) for (const y of [0, CAR.h]) {
      const v = new Vector3(b.centre[0] + dx, y, b.centre[1] + dz).project(c);
      if (v.z > 1) behind = true;
      corners.push(toPx(v));
    }
    if (behind) continue;
    const box = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
    for (const o of bays) {
      const cov = area(clip(polys[o.id], box)) / area(polys[o.id]);
      if (cov >= 0.45) { foreign++; pairs.push(`(${b.id})→${o.id}:${cov.toFixed(2)}`); }
      foreignWorst = Math.max(foreignWorst, cov);
    }
  }
  return { risky, worst: +worst.toFixed(3), foreign, foreignWorst: +foreignWorst.toFixed(3), minArea: Math.round(minArea), minSelf: +minSelf.toFixed(2), pairs };
}

// Mount zone: anywhere under the ceiling facing the owned row across its aisle (over the aisle or the opposite row).
const aisleOf = { 'cam-01': { z0: 6.2, z1: 18.0 }, 'cam-02': { z0: 0.3, z1: 12.2 }, 'cam-03': { z0: 23.8, z1: 35.7 }, 'cam-04': { z0: 18.1, z1: 30.0 } };
const baseYaw = { 'cam-01': 0, 'cam-02': 180, 'cam-03': 0, 'cam-04': 180 };

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const cam of SHOWCASE_CAMERAS) {
    const bays = ownedBays(cam.id);
    console.log(cam.label, JSON.stringify(cam.pose.position), cam.pose.yaw, cam.pose.pitch, cam.pose.fov, JSON.stringify(analyse(cam.pose, bays)));
    if (!process.argv.includes('--search')) continue;
    const a = aisleOf[cam.id];
    const best = [];
    for (let x = 6; x <= 21; x += 1.5)
      for (let z = a.z0; z <= a.z1; z += 0.9)
        for (const y of [3.8])
          for (const dyaw of [-10, -5, 0, 5, 10])
            for (const pitch of [-8, -11, -14, -18, -22, -26, -30])
              for (const fov of [50, 58, 66, 74, 82]) {
                const pose = { position: [+x.toFixed(2), y, +z.toFixed(2)], yaw: baseYaw[cam.id] + dyaw, pitch, roll: 0, fov, width: 1280, height: 720 };
                const r = analyse(pose, bays);
                if (r && r.minSelf >= 0.6) best.push([r.risky + r.foreign, Math.max(r.worst, r.foreignWorst), -r.minArea, pose, r]);
              }
    best.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    for (const [, , , p, r] of best.slice(0, 3)) console.log('   ', JSON.stringify(p.position), p.yaw, p.pitch, p.fov, '| risky', r.risky, 'worst', r.worst, 'foreign', r.foreign, 'fworst', r.foreignWorst, 'minArea', r.minArea, 'minSelf', r.minSelf);
  }
}
