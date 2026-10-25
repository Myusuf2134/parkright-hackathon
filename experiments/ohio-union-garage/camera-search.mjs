// Chooses each Ohio Union-inspired CCTV pose by the production mapper's rule (a bay is OCCUPIED when
// a vehicle box covers >= 45% of its polygon), exactly as experiments/garage-showcase/camera-search.mjs
// does for the 34-space garage. A reference SUV (4.85 x 1.95 x 1.75 m) parked in each owned bay is
// projected to its 2D box; "risky" = it covers >= 45% of ANOTHER owned bay; "foreign" = a car in a bay
// the camera does NOT own covers >= 45% of an owned bay. Bays a camera does not own are never evaluated
// from that camera, so spill onto them is harmless.
//   node camera-search.mjs              evaluate the poses in apps/simulator/src/ohio/layout.ts
//   node camera-search.mjs --search     search poses per camera (heights 2.85–3.15 m under the girders)
import { PerspectiveCamera, Vector3 } from 'three';
import { OHIO_BAYS, OHIO_CAMERAS, ohioOwnedBays } from '../../apps/simulator/src/ohio/layout.ts';

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

function carBox(c, cx, cz) {
  const corners = [];
  let behind = false;
  for (const dx of [-CAR.w / 2, CAR.w / 2]) for (const dz of [-CAR.l / 2, CAR.l / 2]) for (const y of [0, CAR.h]) {
    const v = new Vector3(cx + dx, y, cz + dz).project(c);
    if (v.z > 1) behind = true;
    corners.push(toPx(v));
  }
  return behind ? null : [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
}

export function analyse(pose, bays, allBays = OHIO_BAYS) {
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
    const box = carBox(c, b.centre[0], b.centre[1]);
    minSelf = Math.min(minSelf, area(clip(polys[b.id], box)) / area(polys[b.id]));
    for (const o of bays) {
      if (o.id === b.id) continue;
      const cov = area(clip(polys[o.id], box)) / area(polys[o.id]);
      if (cov >= 0.45) { risky++; pairs.push(`${b.id}→${o.id}:${cov.toFixed(2)}`); }
      worst = Math.max(worst, cov);
    }
  }
  let foreign = 0, foreignWorst = 0;
  for (const b of allBays.filter((x) => !bays.some((o) => o.id === x.id))) {
    const box = carBox(c, b.centre[0], b.centre[1]);
    if (!box) continue;
    for (const o of bays) {
      const cov = area(clip(polys[o.id], box)) / area(polys[o.id]);
      if (cov >= 0.45) { foreign++; pairs.push(`(${b.id})→${o.id}:${cov.toFixed(2)}`); }
      foreignWorst = Math.max(foreignWorst, cov);
    }
  }
  return { risky, worst: +worst.toFixed(3), foreign, foreignWorst: +foreignWorst.toFixed(3), minArea: Math.round(minArea), minSelf: +minSelf.toFixed(2), pairs };
}

// Mount zone: under the girders on the far side of the owned row's aisle, facing it.
const zones = { A: { z0: 13.0, z1: 18.0, yaw: 0 }, B: { z0: 0.3, z1: 5.6, yaw: 180 }, C: { z0: 30.6, z1: 35.6, yaw: 0 }, D: { z0: 18.1, z1: 23.4, yaw: 180 } };

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const cam of OHIO_CAMERAS) {
    const bays = ohioOwnedBays(cam.id);
    const r = analyse(cam.pose, bays);
    console.log(cam.label, cam.row, cam.module, JSON.stringify(cam.pose.position), cam.pose.yaw, cam.pose.pitch, cam.pose.fov, r ? JSON.stringify({ ...r, pairs: r.pairs.slice(0, 6) }) : 'OUT OF FRAME');
    if (!process.argv.includes('--search')) continue;
    const a = zones[cam.row];
    const mid = bays.reduce((s, b) => s + b.centre[0], 0) / bays.length;
    const best = [];
    for (let x = mid - 3; x <= mid + 3; x += 1.5)
      for (let z = a.z0; z <= a.z1; z += 0.85)
        for (const y of [2.85, 3.0, 3.15])
          for (const dyaw of [-6, 0, 6])
            for (const pitch of [-8, -11, -14, -18, -22])
              for (const fov of [58, 66, 74, 82]) {
                const p = { position: [+x.toFixed(2), y, +z.toFixed(2)], yaw: a.yaw + dyaw, pitch, roll: 0, fov, width: 1280, height: 720 };
                const q = analyse(p, bays);
                if (q && q.minSelf >= 0.6) best.push([q.risky + q.foreign, Math.max(q.worst, q.foreignWorst), -q.minArea, p, q]);
              }
    best.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    for (const [, , , p, q] of best.slice(0, 3)) console.log('   ', JSON.stringify(p.position), p.yaw, p.pitch, p.fov, '| risky', q.risky, 'worst', q.worst, 'foreign', q.foreign, 'fworst', q.foreignWorst, 'minArea', q.minArea, 'minSelf', q.minSelf);
  }
}
