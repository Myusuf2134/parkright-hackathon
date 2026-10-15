/**
 * The static deck: a rooftop parking level with concrete parapets, painted bays,
 * wheel stops, lamp posts, a stair core, cam-01's mounting pole, and a city skyline
 * for depth. Built from plain three.js so it can be reused without React.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SpotLight,
  type Texture,
} from 'three';
import { DEFAULT_POSE } from '../camera/pose.ts';
import { BAYS, LOT_SIZE } from '../sim/facility.ts';
import { rng } from '../sim/prng.ts';
import { facadeTexture, surfaceTexture } from './textures.ts';

export const DECK = { minX: -3, maxX: 23, minZ: -3, maxZ: 28 };
export const LAMP_POSITIONS: readonly [number, number][] = [
  [3.8, -1.4],
  [10, -1.4],
  [16.2, -1.4],
  [3.8, 21.4],
  [16.2, 21.4],
];

export interface DeckHandles {
  root: Group;
  lamps: SpotLight[];
  lampHeads: MeshStandardMaterial;
  windows: MeshStandardMaterial[];
}

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, shadows = true): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

export function buildDeck(): DeckHandles {
  const root = new Group();
  root.name = 'deck';

  const concreteTex = surfaceTexture([128, 128, 124], 26, 'concrete', 6);
  const asphaltTex = surfaceTexture([62, 63, 66], 22, 'asphalt', 8);
  const concrete = new MeshStandardMaterial({ color: '#ffffff', map: concreteTex, roughness: 0.92 });
  const asphalt = new MeshStandardMaterial({ color: '#ffffff', map: asphaltTex, roughness: 0.88 });
  const paint = new MeshStandardMaterial({ color: '#e8e6dc', roughness: 0.6 });
  const yellow = new MeshStandardMaterial({ color: '#d9b43a', roughness: 0.6 });
  const metal = new MeshStandardMaterial({ color: '#5d6168', roughness: 0.45, metalness: 0.7 });
  const wall = new MeshStandardMaterial({ color: '#ffffff', map: concreteTex, roughness: 0.95 });

  // Deck slab (concrete) with an asphalt driving surface over the parking area.
  const w = DECK.maxX - DECK.minX;
  const d = DECK.maxZ - DECK.minZ;
  root.add(box(w, 0.6, d, concrete, (DECK.minX + DECK.maxX) / 2, -0.3, (DECK.minZ + DECK.maxZ) / 2, false));
  const surface = new Mesh(new PlaneGeometry(LOT_SIZE.x + 1.2, LOT_SIZE.z + 5), asphalt);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(LOT_SIZE.x / 2, 0.005, LOT_SIZE.z / 2 + 2);
  surface.receiveShadow = true;
  root.add(surface);

  // Bay markings: shared side lines, a back line per row, and a concrete wheel stop per bay.
  const lineXs = new Set<number>();
  for (const b of BAYS) for (const s of [-1, 1]) lineXs.add(Math.round((b.x + s * (b.width / 2 + 0.2)) * 100) / 100);
  for (const row of ['A', 'B']) {
    const bays = BAYS.filter((b) => b.row === row);
    const b0 = bays[0]!;
    const backZ = b0.z - (b0.opensTo * b0.depth) / 2;
    for (const x of lineXs) root.add(box(0.12, 0.01, b0.depth, paint, x, 0.012, b0.z, false));
    const xs = [...lineXs];
    root.add(box(Math.max(...xs) - Math.min(...xs) + 0.12, 0.01, 0.12, paint, (Math.max(...xs) + Math.min(...xs)) / 2, 0.012, backZ, false));
    for (const b of bays) root.add(box(1.7, 0.14, 0.22, concrete, b.x, 0.07, backZ + b.opensTo * 0.75));
  }
  // Aisle direction arrows and a yellow edge line along the parapets.
  for (const x of [5, 15]) {
    root.add(box(1.6, 0.01, 0.16, paint, x, 0.012, 10));
    const head = new Mesh(new CylinderGeometry(0, 0.45, 0.01, 3), paint);
    head.rotation.y = -Math.PI / 2;
    head.position.set(x + 1.0, 0.012, 10);
    root.add(head);
  }
  root.add(box(0.12, 0.01, d - 1, yellow, DECK.minX + 0.6, 0.012, (DECK.minZ + DECK.maxZ) / 2, false));
  root.add(box(0.12, 0.01, d - 1, yellow, DECK.maxX - 0.6, 0.012, (DECK.minZ + DECK.maxZ) / 2, false));

  // Parapets with a gap on the east side for the ramp.
  const h = 1.1;
  root.add(box(w, h, 0.3, wall, (DECK.minX + DECK.maxX) / 2, h / 2, DECK.minZ + 0.15));
  root.add(box(w, h, 0.3, wall, (DECK.minX + DECK.maxX) / 2, h / 2, DECK.maxZ - 0.15));
  root.add(box(0.3, h, d, wall, DECK.minX + 0.15, h / 2, (DECK.minZ + DECK.maxZ) / 2));
  root.add(box(0.3, h, 13, wall, DECK.maxX - 0.15, h / 2, DECK.minZ + 6.5));
  root.add(box(0.3, h, 12, wall, DECK.maxX - 0.15, h / 2, DECK.maxZ - 6));
  // Steel guard rail on top of the parapets.
  root.add(box(w, 0.06, 0.08, metal, (DECK.minX + DECK.maxX) / 2, h + 0.15, DECK.minZ + 0.15));
  root.add(box(0.08, 0.06, d, metal, DECK.minX + 0.15, h + 0.15, (DECK.minZ + DECK.maxZ) / 2));

  // Stair / lift core in the north-west corner.
  const core = new Group();
  core.add(box(4.2, 3.4, 3.6, wall, -0.6, 1.7, -5.0));
  core.add(box(1.1, 2.1, 0.08, metal, -0.2, 1.05, -3.17));
  core.add(box(4.5, 0.25, 3.9, concrete, -0.6, 3.5, -5.0));
  root.add(core);

  // Lamp posts with spotlights. Intensity is set per environment preset.
  const lampHeads = new MeshStandardMaterial({ color: '#2a2c30', emissive: '#ffd29a', emissiveIntensity: 0, roughness: 0.4 });
  const lamps: SpotLight[] = [];
  for (const [x, z] of LAMP_POSITIONS) {
    root.add(box(0.18, 7, 0.18, metal, x, 3.5, z));
    const armDir = z < 10 ? 1 : -1;
    root.add(box(0.1, 0.1, 1.4, metal, x, 6.9, z + armDir * 0.7));
    root.add(box(0.6, 0.12, 0.35, lampHeads, x, 6.82, z + armDir * 1.35, false));
    const spot = new SpotLight('#ffd29a', 0, 34, 1.05, 0.6, 1.6);
    spot.position.set(x, 6.7, z + armDir * 1.35);
    spot.target.position.set(x, 0, z + armDir * 6);
    root.add(spot, spot.target);
    lamps.push(spot);
  }

  // cam-01's mounting pole and bracket, entirely behind the lens so they never enter its own feed.
  const [cx, cy, cz] = DEFAULT_POSE.position;
  root.add(box(0.22, cy + 0.3, 0.22, metal, cx, (cy + 0.3) / 2 - 0.3, cz + 0.9));
  root.add(box(0.12, 0.12, 0.5, metal, cx, cy, cz + 0.55));
  root.add(box(0.22, 0.2, 0.3, metal, cx, cy, cz + 0.25));

  // Ground far below the deck, and a skyline for depth.
  const ground = new Mesh(new PlaneGeometry(600, 600), new MeshStandardMaterial({ color: '#7a7d78', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -14;
  root.add(ground);
  const windows = buildSkyline(root);

  return { root, lamps, lampHeads, windows };
}

function buildSkyline(root: Group): MeshStandardMaterial[] {
  const r = rng(1, 'skyline');
  const windows: MeshStandardMaterial[] = [];
  const textures: [Texture, Texture][] = [0, 1, 2].map((i) => [facadeTexture(`f${i}`, false), facadeTexture(`f${i}`, true)]);
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2 + r.range(-0.08, 0.08);
    const dist = r.range(55, 120);
    const bw = r.range(10, 26);
    const bd = r.range(10, 26);
    const bh = r.range(14, 70);
    const [day, night] = r.pick(textures);
    const map = day.clone();
    map.repeat.set(Math.max(1, Math.round(bw / 8)), Math.max(1, Math.round(bh / 10)));
    const emissiveMap = night.clone();
    emissiveMap.repeat.copy(map.repeat);
    const mat = new MeshStandardMaterial({ color: '#ffffff', map, emissive: '#ffffff', emissiveMap, emissiveIntensity: 0, roughness: 0.85 });
    windows.push(mat);
    const b = new Mesh(new BoxGeometry(bw, bh, bd), mat);
    b.position.set(10 + Math.cos(angle) * dist, -14 + bh / 2, 12 + Math.sin(angle) * dist);
    b.rotation.y = r.range(-0.3, 0.3);
    root.add(b);
  }
  return windows;
}
