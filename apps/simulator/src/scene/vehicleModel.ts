/**
 * Procedural vehicles: five body styles with real-world proportions, painted body,
 * glass cabin, wheels and lamps. Local frame: origin on the ground at the vehicle's
 * centre, nose towards +z.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { VehicleSpec } from '../sim/vehicles.ts';

const glass = new MeshStandardMaterial({ color: '#1a222c', roughness: 0.08, metalness: 0.3 });
const tyre = new MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
const rim = new MeshStandardMaterial({ color: '#8b9096', roughness: 0.35, metalness: 0.8 });
const trim = new MeshStandardMaterial({ color: '#1e1f22', roughness: 0.7 });
const headlight = new MeshStandardMaterial({ color: '#d9dde2', emissive: '#fff6e0', emissiveIntensity: 0.05, roughness: 0.2 });
const taillight = new MeshStandardMaterial({ color: '#5a0d10', emissive: '#ff2a2a', emissiveIntensity: 0.05, roughness: 0.3 });
const wheelGeometry = new CylinderGeometry(0.34, 0.34, 0.24, 20);
const rimGeometry = new CylinderGeometry(0.2, 0.2, 0.25, 12);
const paints = new Map<string, MeshStandardMaterial>();

/** Geometry shared by every vehicle; everything else belongs to one vehicle and is disposed with it. */
export const SHARED_GEOMETRY: ReadonlySet<unknown> = new Set([wheelGeometry, rimGeometry]);

const paint = (color: string) => {
  let m = paints.get(color);
  if (!m) paints.set(color, (m = new MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.55 })));
  return m;
};

function part(geometry: BoxGeometry | RoundedBoxGeometry | CylinderGeometry, material: MeshStandardMaterial, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cabin placement per style: [length fraction, centre offset fraction (+ = forward)]. */
const CABIN: Record<VehicleSpec['kind'], [number, number]> = {
  sedan: [0.48, -0.04],
  hatchback: [0.56, -0.1],
  suv: [0.68, -0.08],
  pickup: [0.36, 0.08],
  van: [0.84, -0.04],
};

export function buildVehicle(v: VehicleSpec): Group {
  const g = new Group();
  g.name = `vehicle:${v.kind}`;
  const body = paint(v.color);
  const L = v.length;
  const W = v.width;
  const clearance = 0.18;
  const bodyH = v.kind === 'van' ? v.height * 0.45 : v.height * 0.5;
  const bodyY = clearance + bodyH / 2 + 0.1;

  g.add(part(new RoundedBoxGeometry(W, bodyH, L, 3, 0.12), body, 0, bodyY, 0));

  const [cabinFrac, cabinOffset] = CABIN[v.kind];
  const cabinH = v.height - (clearance + 0.1 + bodyH);
  const cabinL = L * cabinFrac;
  const cabinZ = L * cabinOffset;
  const cabinY = clearance + 0.1 + bodyH + cabinH / 2 - 0.02;
  g.add(part(new RoundedBoxGeometry(W * 0.9, cabinH, cabinL, 3, 0.14), glass, 0, cabinY, cabinZ));
  // Roof panel and pillars in body colour so the cabin reads as a car, not a glass box.
  g.add(part(new RoundedBoxGeometry(W * 0.88, 0.06, cabinL * 0.86, 2, 0.03), body, 0, cabinY + cabinH / 2, cabinZ));
  for (const side of [-1, 1]) g.add(part(new BoxGeometry(0.05, cabinH * 0.95, 0.12), body, (side * W * 0.9) / 2, cabinY, cabinZ));

  if (v.kind === 'pickup') {
    const bedL = L * 0.4;
    const bedZ = -L / 2 + bedL / 2 + 0.05;
    const top = clearance + 0.1 + bodyH;
    for (const side of [-1, 1]) g.add(part(new BoxGeometry(0.08, 0.38, bedL), body, (side * (W - 0.08)) / 2, top + 0.19, bedZ));
    g.add(part(new BoxGeometry(W, 0.38, 0.08), body, 0, top + 0.19, -L / 2 + 0.06));
  }

  // Wheels.
  const axle = L / 2 - Math.min(0.95, L * 0.19);
  for (const z of [axle, -axle]) {
    for (const side of [-1, 1]) {
      const wheel = part(wheelGeometry, tyre, (side * (W - 0.16)) / 2, 0.34, z);
      wheel.rotation.z = Math.PI / 2;
      const hub = part(rimGeometry, rim, (side * (W - 0.14)) / 2, 0.34, z);
      hub.rotation.z = Math.PI / 2;
      g.add(wheel, hub);
    }
  }

  // Bumpers and lamps.
  g.add(part(new BoxGeometry(W * 0.96, 0.18, 0.1), trim, 0, clearance + 0.16, L / 2 - 0.02));
  g.add(part(new BoxGeometry(W * 0.96, 0.18, 0.1), trim, 0, clearance + 0.16, -L / 2 + 0.02));
  for (const side of [-1, 1]) {
    g.add(part(new BoxGeometry(0.34, 0.1, 0.05), headlight, side * (W / 2 - 0.3), bodyY + bodyH * 0.18, L / 2 + 0.005));
    g.add(part(new BoxGeometry(0.3, 0.1, 0.05), taillight, side * (W / 2 - 0.28), bodyY + bodyH * 0.2, -L / 2 - 0.005));
  }
  return g;
}
