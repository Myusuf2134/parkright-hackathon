/**
 * OFFLINE DATASET labels that follow from simulator state and camera geometry alone —
 * no rendering, no detector. Runs identically in the browser and in Node tests.
 *
 * Amodal vehicle boxes: the vehicle mesh is rebuilt with the simulator's own
 * buildVehicle(spec), placed exactly as VehicleLayer places it (position x,0,z; rotation
 * about +y by heading), and EVERY mesh vertex is projected through a PerspectiveCamera set
 * up exactly like cam-01 (pose.ts / virtualCamera.ts). The box is the min/max of the
 * projected vertices, then clamped to the image; `truncated` records that clamping cut it.
 */
import { type Mesh, PerspectiveCamera, Vector3 } from 'three';
import { type CameraPose, poseEuler } from '../camera/pose.ts';
import { buildVehicle, SHARED_GEOMETRY } from '../scene/vehicleModel.ts';
import { type VehiclePose, World } from '../sim/world.ts';
import { occluderCorners, type OccluderSpec } from './occluders.ts';
import type { SamplePlan } from './plan.ts';

export type Box = [number, number, number, number];

export interface VehicleLabel {
  instance_id: string;
  class: string;
  color: string;
  space_id: string;
  phase: VehiclePose['phase'];
  world: { x: number; z: number; heading: number; length: number; width: number; height: number };
  /** Projected full extent, clamped to the image, pixels [x_min, y_min, x_max, y_max]. */
  bbox_amodal: Box | null;
  /** Projected full extent before clamping (may lie partly outside the image). */
  bbox_projected: Box;
  truncated: boolean;
}

export interface ObjectLabel {
  instance_id: string;
  class: 'occluder';
  kind: OccluderSpec['kind'];
  bbox_amodal: Box | null;
  truncated: boolean;
}

export function cameraFor(pose: CameraPose): PerspectiveCamera {
  const camera = new PerspectiveCamera(pose.fov, pose.width / pose.height, 0.1, 400);
  camera.position.set(...pose.position);
  camera.rotation.set(...poseEuler(pose), 'YXZ');
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** Puts `world` into the exact state a sample describes. */
export function stageWorld(world: World, sample: SamplePlan, camera: CameraPose): void {
  world.setTraffic(false);
  world.load({ seed: sample.seed, preset: sample.preset, occupancy: sample.occupancy, camera });
  const t = sample.transition;
  if (!t) return;
  world.play();
  if (t.kind === 'arrive') world.park(t.space_id, t.nonce);
  else world.remove(t.space_id);
  for (let left = t.elapsed_ms; left > 0; left -= 250) world.advance(Math.min(250, left));
  world.pause();
}

const localVertices = new Map<string, Float32Array>();

/** Every vertex of the vehicle's meshes in the vehicle's local frame. */
function vehicleVertices(v: VehiclePose, seed: number): Float32Array {
  const key = `${seed}:${v.key}`;
  let out = localVertices.get(key);
  if (out) return out;
  const group = buildVehicle(v.spec);
  group.updateMatrixWorld(true);
  const points: number[] = [];
  const p = new Vector3();
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      points.push(p.x, p.y, p.z);
    }
    if (!SHARED_GEOMETRY.has(mesh.geometry)) mesh.geometry.dispose();
  });
  out = new Float32Array(points);
  if (localVertices.size > 4000) localVertices.clear();
  localVertices.set(key, out);
  return out;
}

function boxOf(points: Iterable<[number, number, number]>, camera: PerspectiveCamera, pose: CameraPose) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const p = new Vector3();
  for (const [x, y, z] of points) {
    p.set(x, y, z).project(camera);
    if (p.z < -1 || p.z > 1) throw new Error('object vertex outside the camera depth range');
    const px = ((p.x + 1) / 2) * pose.width;
    const py = ((1 - p.y) / 2) * pose.height;
    x0 = Math.min(x0, px);
    y0 = Math.min(y0, py);
    x1 = Math.max(x1, px);
    y1 = Math.max(y1, py);
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const projected: Box = [r(x0), r(y0), r(x1), r(y1)];
  const clamped: Box = [r(Math.max(0, x0)), r(Math.max(0, y0)), r(Math.min(pose.width, x1)), r(Math.min(pose.height, y1))];
  const inside = clamped[2] > clamped[0] && clamped[3] > clamped[1];
  const truncated = inside && (x0 < 0 || y0 < 0 || x1 > pose.width || y1 > pose.height);
  return { projected, amodal: inside ? clamped : null, truncated };
}

function* worldPoints(v: VehiclePose, local: Float32Array): Generator<[number, number, number]> {
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  for (let i = 0; i < local.length; i += 3) {
    const x = local[i]!;
    const z = local[i + 2]!;
    // Rotation about +y (three.js convention), then translation to (v.x, 0, v.z).
    yield [v.x + c * x + s * z, local[i + 1]!, v.z - s * x + c * z];
  }
}

export function vehicleLabels(world: World, camera: PerspectiveCamera, pose: CameraPose): VehicleLabel[] {
  return world.vehicles().map((v) => {
    const { projected, amodal, truncated } = boxOf(worldPoints(v, vehicleVertices(v, world.spec.seed)), camera, pose);
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return {
      instance_id: v.key,
      class: v.spec.kind,
      color: v.spec.color,
      space_id: v.spaceId,
      phase: v.phase,
      world: { x: r(v.x), z: r(v.z), heading: r(v.heading), length: r(v.spec.length), width: r(v.spec.width), height: r(v.spec.height) },
      bbox_amodal: amodal,
      bbox_projected: projected,
      truncated,
    };
  });
}

export function occluderLabels(occluders: readonly OccluderSpec[], camera: PerspectiveCamera, pose: CameraPose): ObjectLabel[] {
  return occluders.map((o) => {
    const { amodal, truncated } = boxOf(occluderCorners(o), camera, pose);
    return { instance_id: o.id, class: 'occluder', kind: o.kind, bbox_amodal: amodal, truncated };
  });
}
