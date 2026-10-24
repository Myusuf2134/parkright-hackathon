// Camera-placement analysis for the garage, using the production mapper's rule: a bay is
// OCCUPIED when a vehicle box covers >= 45% of its polygon. For each bay, a reference SUV
// (4.85 x 1.95 x 1.75 m) parked in it is projected to its 2D box; we measure how much of
// every OTHER bay that box covers. Coverage >= 0.45 means a guaranteed neighbour false
// positive for a perfect detector, purely from viewing geometry.
//   node camera-geometry.mjs [--search]
import { PerspectiveCamera, Vector3 } from 'three';
import { GARAGE, GARAGE_BAYS, GARAGE_CAM01_POSE } from '../../apps/simulator/src/garage/layout.ts';

const DEG = Math.PI / 180;
const CAR = { l: 4.85, w: 1.95, h: 1.75 };

function camera(p) {
  const c = new PerspectiveCamera(p.fov, 16 / 9, 0.1, 400);
  c.position.set(...p.position);
  c.rotation.set(p.pitch * DEG, p.yaw * DEG, 0, 'YXZ');
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}
const toPx = (v) => [(v.x + 1) / 2 * 1280, (1 - v.y) / 2 * 720];

function clip(poly, [x0, y0, x1, y1]) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]], [(p) => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let out = poly;
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return [];
  }
  return out;
}
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };

export function analyse(pose) {
  const c = camera(pose);
  const polys = {};
  for (const b of GARAGE_BAYS) {
    const pts = b.corners.map((q) => new Vector3(...q).project(c));
    if (pts.some((q) => q.z > 1 || Math.abs(q.x) > 0.97 || Math.abs(q.y) > 0.95)) return null;
    polys[b.id] = pts.map(toPx);
  }
  let worst = 0, risky = 0, minArea = Infinity, minSelf = 1;
  const pairs = [];
  for (const b of GARAGE_BAYS) {
    minArea = Math.min(minArea, area(polys[b.id]));
    const [cx, cz] = b.centre;
    const corners = [];
    for (const dx of [-CAR.w / 2, CAR.w / 2]) for (const dz of [-CAR.l / 2, CAR.l / 2]) for (const y of [0, CAR.h]) corners.push(toPx(new Vector3(cx + dx, y, cz + dz).project(c)));
    const box = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))];
    minSelf = Math.min(minSelf, area(clip(polys[b.id], box)) / area(polys[b.id]));
    for (const o of GARAGE_BAYS) {
      if (o.id === b.id) continue;
      const cov = area(clip(polys[o.id], box)) / area(polys[o.id]);
      if (cov >= 0.45) { risky++; pairs.push(`${b.id}→${o.id}:${cov.toFixed(2)}`); }
      worst = Math.max(worst, cov);
    }
  }
  return { worst: +worst.toFixed(3), risky, minArea: Math.round(minArea), minSelf: +minSelf.toFixed(2), pairs };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log('current CAM-01', JSON.stringify(GARAGE_CAM01_POSE.position), GARAGE_CAM01_POSE.yaw, GARAGE_CAM01_POSE.pitch, GARAGE_CAM01_POSE.fov, JSON.stringify(analyse(GARAGE_CAM01_POSE)));

if (process.argv.includes('--search')) {
  const maxY = GARAGE.ceiling - GARAGE.beamDepth - 0.1;
  const res = [];
  for (const x of [-4, -1, 0, 3, 6, 9.8, 13.6, 16.6, 19.6, 23])
    for (const z of [1.2, 10, 19.5, 21.5])
      for (const y of [3.4, maxY])
        for (let yaw = -180; yaw < 180; yaw += 5)
          for (const pitch of [-20, -25, -30, -35, -40, -45, -50])
            for (const fov of [55, 62, 70, 78]) {
              const pose = { position: [x, y, z], yaw, pitch, roll: 0, fov, width: 1280, height: 720 };
              const a = analyse(pose);
              if (a && a.minSelf >= 0.6) res.push([a.risky, a.worst, -a.minArea, pose, a]);
            }
  res.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  for (const [, , , p, a] of res.slice(0, 10)) console.log(JSON.stringify(p.position), p.yaw, p.pitch, p.fov, '| risky', a.risky, 'worst', a.worst, 'minArea', a.minArea, a.pairs.slice(0, 4).join(' '));
}
