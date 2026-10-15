/**
 * Keeps the vehicles in the three.js scene exactly in step with the World. Imperative
 * on purpose: sync() is called right before every render, so the pixels cam-01
 * captures and the ground truth recorded for that frame always describe the same
 * instant — no React commit can fall between them.
 */
import { Group } from 'three';
import type { World } from '../sim/world.ts';
import { buildVehicle, SHARED_GEOMETRY } from './vehicleModel.ts';

export class VehicleLayer {
  readonly root = new Group();
  private meshes = new Map<string, Group>();

  constructor() {
    this.root.name = 'vehicles';
  }

  sync(world: World): void {
    const seen = new Set<string>();
    for (const v of world.vehicles()) {
      seen.add(v.key);
      let mesh = this.meshes.get(v.key);
      if (!mesh) {
        mesh = buildVehicle(v.spec);
        this.meshes.set(v.key, mesh);
        this.root.add(mesh);
      }
      mesh.position.set(v.x, 0, v.z);
      mesh.rotation.set(0, v.heading, 0);
    }
    for (const [key, mesh] of this.meshes) {
      if (seen.has(key)) continue;
      this.root.remove(mesh);
      mesh.traverse((o) => {
        const geometry = (o as { geometry?: { dispose(): void } }).geometry;
        if (geometry && !SHARED_GEOMETRY.has(geometry)) geometry.dispose();
      });
      this.meshes.delete(key);
    }
  }
}
