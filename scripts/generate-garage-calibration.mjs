// 3D garage calibration: project each bay's known 3D floor corners through CAM-01.
//   node scripts/generate-garage-calibration.mjs           write
//   node scripts/generate-garage-calibration.mjs --check   fail if the committed files drift
// Static geometry only: imports the garage layout and camera pose, never the world,
// vehicles, ground truth or evaluation code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { poseEuler } from '../apps/simulator/src/camera/pose.ts';
import { FLOOR_Y, GARAGE_BAYS, GARAGE_CAM01_POSE, GARAGE_CAMERA_ID } from '../apps/simulator/src/garage/layout.ts';

export function projectBays(pose = GARAGE_CAM01_POSE) {
  const camera = new PerspectiveCamera(pose.fov, pose.width / pose.height, 0.1, 400);
  camera.position.set(...pose.position);
  camera.rotation.set(...poseEuler(pose), 'YXZ');
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const polygons = {};
  const pixels = {};
  const unobservable = [];
  for (const bay of GARAGE_BAYS) {
    const p = bay.corners.map((c) => new Vector3(...c).project(camera));
    if (p.some((q) => q.z < -1 || q.z > 1 || Math.abs(q.x) > 1 || Math.abs(q.y) > 1)) {
      unobservable.push(bay.id);
      continue;
    }
    polygons[bay.id] = p.map((q) => ({ x: Number(((q.x + 1) / 2).toFixed(9)), y: Number(((1 - q.y) / 2).toFixed(9)) }));
    pixels[bay.id] = polygons[bay.id].map(({ x, y }) => [Math.round(x * pose.width * 10) / 10, Math.round(y * pose.height * 10) / 10]);
  }
  return { polygons, pixels, unobservable };
}

const { polygons, pixels, unobservable } = projectBays();
const pose = GARAGE_CAM01_POSE;
const calibration = {
  version: 'garage-cam-01-v2',
  camera_id: GARAGE_CAMERA_ID,
  pose,
  projection: `Three.js PerspectiveCamera / YXZ / bay floor corners at y=${FLOOR_Y} m projected through CAM-01`,
  image: { width: pose.width, height: pose.height },
  polygons,
  unobservable,
  bays_3d: Object.fromEntries(GARAGE_BAYS.map((b) => [b.id, { row: b.row, level: b.level, corners: b.corners }])),
  pixels,
};
const fixture = JSON.parse(readFileSync(new URL('../packages/shared/fixtures/mvp-facility.json', import.meta.url)));
const facility = { ...fixture, name: 'ParkRight 3D Garage', cameras: fixture.cameras.map((c) => ({ ...c, name: 'CAM-01 (garage corner CCTV)', polygons })) };

const dir = new URL('../packages/shared/calibration/garage/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, data] of [['cam-01.json', calibration], ['facility.json', facility]]) {
  const path = new URL(name, dir);
  const text = JSON.stringify(data, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== text) throw new Error(`garage calibration drift: ${name} (run node scripts/generate-garage-calibration.mjs)`);
  } else writeFileSync(path, text);
}
console.log(`${Object.keys(polygons).length} observable calibrated bays; unobservable: ${unobservable.join(',') || 'none'}`);
