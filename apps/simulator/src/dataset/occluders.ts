/**
 * OFFLINE DATASET occluders: plain boxes that are really rendered into the scene, so any
 * occlusion in a dataset JPEG is physical, not painted on. Placement keeps them outside
 * every bay and away from the lamp posts, so they never intersect a parked vehicle.
 *
 *   crate  — a wide box standing in the aisle, hiding the lower body of row-A vehicles
 *            (train/val/test family). cam-01 looks down from 10.5 m, so anything lower
 *            than ~2 m in front of row B sits below every line of sight and hides nothing.
 *   pillar — tall thin columns, one in the aisle and one near the camera (robustness only)
 */
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import type { Rng } from '../sim/prng.ts';

export interface OccluderSpec {
  id: string;
  kind: 'crate' | 'pillar';
  /** Box centre on the ground (m) and full size (m): x across, y up, z along. */
  x: number;
  z: number;
  size: [number, number, number];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The aisle spans z 7.6–12.4 m; a crate at most 1.5 m deep centred in 9.2–10.8 stays inside it. */
export function crate(r: Rng, id: string): OccluderSpec {
  return { id, kind: 'crate', x: round(r.range(3, 17)), z: round(r.range(9.2, 10.8)), size: [round(r.range(2, 3.5)), round(r.range(1.6, 2.4)), round(r.range(1, 1.5))] };
}

export function pillars(r: Rng, prefix: string): OccluderSpec[] {
  return [
    { id: `${prefix}-aisle`, kind: 'pillar', x: round(r.range(2, 18)), z: round(r.range(9.2, 10.8)), size: [0.8, 4.5, 0.8] },
    { id: `${prefix}-near`, kind: 'pillar', x: round(r.range(2, 18)), z: round(r.range(19.4, 20.4)), size: [0.8, 4.5, 0.8] },
  ];
}

const concrete = new MeshStandardMaterial({ color: '#8d8a84', roughness: 0.93 });

export function buildOccluder(o: OccluderSpec): Mesh {
  const mesh = new Mesh(new BoxGeometry(...o.size), concrete);
  mesh.name = `occluder:${o.id}`;
  mesh.position.set(o.x, o.size[1] / 2, o.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The eight corners of an occluder box in world space. */
export function occluderCorners(o: OccluderSpec): [number, number, number][] {
  const [w, h, d] = o.size;
  const out: [number, number, number][] = [];
  for (const dx of [-w / 2, w / 2]) for (const y of [0, h]) for (const dz of [-d / 2, d / 2]) out.push([o.x + dx, y, o.z + dz]);
  return out;
}
