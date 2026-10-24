/**
 * Garage vehicles: the simulator's procedural body styles (sedan, hatchback, SUV, pickup,
 * van; scene/vehicleModel.ts) with a few extra details that read at CCTV distance:
 * mirrors, number plates and a grille. All built in code; no external assets.
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { buildVehicle, SHARED_GEOMETRY } from '../scene/vehicleModel.ts';
import type { GarageVehiclePose } from './scenarios.ts';

const plate = new MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.5 });
const grille = new MeshStandardMaterial({ color: '#141518', roughness: 0.6, metalness: 0.4 });
const plateGeo = new BoxGeometry(0.52, 0.12, 0.02);
const mirrorGeo = new BoxGeometry(0.2, 0.12, 0.1);
const DETAIL_SHARED = new Set<unknown>([plateGeo, mirrorGeo, ...SHARED_GEOMETRY]);

function detailed(pose: GarageVehiclePose): Group {
  const v = pose.spec;
  const g = buildVehicle(v);
  const body = (g.children[0] as Mesh).material as MeshStandardMaterial;
  const bodyTop = v.kind === 'van' ? v.height * 0.45 + 0.28 : v.height * 0.5 + 0.28;
  for (const z of [v.length / 2 + 0.02, -v.length / 2 - 0.02]) {
    const p = new Mesh(plateGeo, plate);
    p.position.set(0, 0.42, z);
    g.add(p);
  }
  const gr = new Mesh(new BoxGeometry(v.width * 0.5, 0.16, 0.03), grille);
  gr.position.set(0, bodyTop - 0.12, v.length / 2 + 0.01);
  g.add(gr);
  for (const side of [-1, 1]) {
    const m = new Mesh(mirrorGeo, body);
    m.position.set(side * (v.width / 2 + 0.08), bodyTop + 0.12, v.length * 0.16);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

export class GarageVehicleLayer {
  readonly root = new Group();
  private meshes = new Map<string, Group>();

  constructor() {
    this.root.name = 'garage-vehicles';
  }

  sync(poses: readonly GarageVehiclePose[]): void {
    const seen = new Set<string>();
    for (const p of poses) {
      seen.add(p.id);
      let mesh = this.meshes.get(p.id);
      if (!mesh) {
        mesh = detailed(p);
        this.meshes.set(p.id, mesh);
        this.root.add(mesh);
      }
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.set(0, p.heading, 0);
    }
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.root.remove(mesh);
      mesh.traverse((o) => {
        const geometry = (o as { geometry?: { dispose(): void } }).geometry;
        if (geometry && !DETAIL_SHARED.has(geometry)) geometry.dispose();
      });
      this.meshes.delete(id);
    }
  }

  clear(): void {
    this.sync([]);
  }
}
