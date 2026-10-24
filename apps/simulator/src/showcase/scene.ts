/**
 * The 34-space showcase garage in plain three.js: slab, four rows of painted bays with stencilled
 * IDs and wheel stops, two one-way aisles with arrows, the east turnaround and ramp, island
 * divider, columns, perimeter walls open to the street, entrance and exit gates, walkway with
 * stairs and lift, ceiling with beams and LED fixtures, CCTV housings, signage. Presets reuse the
 * 12-space garage's (garage/presets.ts) through the same handle shape.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from 'three';
import type { GarageHandles } from '../garage/scene.ts';
import { CEILING_LAYER, setLayerDeep } from '../scene/layers.ts';
import { facadeTexture, surfaceTexture } from '../scene/textures.ts';
import { BAY_PITCH, SHOWCASE, SHOWCASE_BAYS, SHOWCASE_CAMERAS } from './layout.ts';

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, cast = true): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function textTexture(text: string, fg: string, bg?: string, font = 'bold 84px Helvetica, Arial, sans-serif', w = 256, h = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function decal(tex: CanvasTexture, w: number, h: number, x: number, z: number, rotation = 0): Mesh {
  const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false }));
  m.rotation.set(-Math.PI / 2, 0, rotation);
  m.position.set(x, 0.022, z);
  m.receiveShadow = true;
  return m;
}

function arrow(mat: MeshStandardMaterial, x: number, z: number, angle: number): Mesh {
  const s = new Shape();
  s.moveTo(-1.2, -0.16);
  s.lineTo(0.3, -0.16);
  s.lineTo(0.3, -0.42);
  s.lineTo(1.2, 0);
  s.lineTo(0.3, 0.42);
  s.lineTo(0.3, 0.16);
  s.lineTo(-1.2, 0.16);
  s.closePath();
  const m = new Mesh(new ShapeGeometry(s), mat);
  m.rotation.set(-Math.PI / 2, 0, angle);
  m.position.set(x, 0.021, z);
  m.receiveShadow = true;
  return m;
}

const sign = (text: string, fg: string, bg: string, w: number, h: number, font?: string) =>
  new MeshStandardMaterial({ map: textTexture(text, fg, bg, font ?? 'bold 64px Helvetica, Arial, sans-serif', Math.round(256 * (w / h)), 256), roughness: 0.5 });

export function buildShowcaseGarage(): GarageHandles {
  const root = new Group();
  root.name = 'showcase-garage';
  const G = SHOWCASE;
  const W = G.maxX - G.minX;
  const D = G.maxZ - G.minZ;
  const cx = (G.minX + G.maxX) / 2;
  const cz = (G.minZ + G.maxZ) / 2;

  const slab = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([132, 131, 126], 22, 'showcase-slab', 10), roughness: 0.86 });
  const wallTex = surfaceTexture([150, 149, 144], 18, 'showcase-wall', 5);
  const wall = new MeshStandardMaterial({ color: '#ffffff', map: wallTex, roughness: 0.93 });
  const ceiling = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([120, 120, 118], 14, 'showcase-ceiling', 7), roughness: 0.95, side: DoubleSide });
  const white = new MeshStandardMaterial({ color: '#e9e7de', roughness: 0.55 });
  const yellow = new MeshStandardMaterial({ color: '#d8b13a', roughness: 0.55 });
  const curb = new MeshStandardMaterial({ color: '#9a9890', roughness: 0.9 });
  const pipe = new MeshStandardMaterial({ color: '#a8352d', roughness: 0.5, metalness: 0.3 });
  const housing = new MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.4, metalness: 0.5 });
  const dome = new MeshStandardMaterial({ color: '#1b1d20', roughness: 0.3, metalness: 0.4 });
  const tubes = new MeshStandardMaterial({ color: '#ffffff', emissive: '#f3f6ff', emissiveIntensity: 2.2, roughness: 0.3 });
  const exitSign = new MeshStandardMaterial({ color: '#0f7a3a', emissive: '#1fd16a', emissiveIntensity: 1.2, map: textTexture('EXIT', '#ffffff', '#0f7a3a') });
  const street = new MeshStandardMaterial({ color: '#8d8a80', roughness: 0.95 });

  const floor = new Mesh(new PlaneGeometry(W, D), slab);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  const outside = new Mesh(new PlaneGeometry(320, 320), street);
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(cx, -0.6, cz);
  root.add(floor, outside);

  // Bays: lines on the 2.8 m pitch, wheel stops, stencilled IDs.
  for (const row of ['A', 'B', 'C', 'D'] as const) {
    const bays = SHOWCASE_BAYS.filter((b) => b.row === row);
    const z0 = bays[0]!.corners[0][2];
    const z1 = bays[0]!.corners[2][2];
    for (let i = 0; i <= bays.length; i++) root.add(box(0.12, 0.006, z1 - z0, white, bays[0]!.corners[0][0] - 0.1 + BAY_PITCH * i, 0.012, (z0 + z1) / 2, false));
    for (const b of bays) {
      const back = b.opensTo === 1 ? z0 + 0.4 : z1 - 0.4;
      root.add(box(1.7, 0.13, 0.16, curb, b.centre[0], 0.065, back));
      const stencil = b.opensTo === 1 ? z0 + 1.15 : z1 - 1.15;
      root.add(decal(textTexture(b.id, 'rgba(235,233,224,0.92)'), 1.1, 0.55, b.centre[0], stencil, b.opensTo === 1 ? 0 : Math.PI));
    }
  }

  // Island divider between rows B and C, with yellow kerb paint.
  const [iz0, iz1] = G.islandZ;
  root.add(box(G.islandEndX - 0.4, 0.16, iz1 - iz0 + 0.1, curb, (0.4 + G.islandEndX) / 2, 0.08, (iz0 + iz1) / 2));
  root.add(box(0.5, 0.17, 11.2, yellow, G.islandEndX + 0.05, 0.085, (iz0 + iz1) / 2, false));

  // Aisles: dashed lane edges, direction arrows, turnaround arrows, crosswalks to the walkway.
  for (const a of [G.aisle1, G.aisle2]) {
    for (let x = -6; x < 26; x += 3) root.add(box(1.5, 0.006, 0.1, yellow, x + 0.75, 0.012, (a.z0 + a.z1) / 2 + (a === G.aisle1 ? 1.6 : -1.6), false));
  }
  for (const x of [2.5, 12.5, 21.5]) root.add(arrow(white, x, G.aisle1.lane, 0));
  for (const x of [5.5, 15.5, 24.5]) root.add(arrow(white, x, G.aisle2.lane, Math.PI));
  root.add(arrow(white, G.loopX, 18.1, -Math.PI / 2));
  for (let k = 0; k < 6; k++) root.add(box(0.45, 0.006, 4.4, white, 3 + k * 0.75, 0.012, G.aisle2.lane + 0.6, false));
  root.add(decal(textTexture('EXIT', 'rgba(240,238,230,0.95)', undefined, 'bold 96px Helvetica, Arial, sans-serif'), 2.2, 1.0, -4.5, G.aisle2.lane, Math.PI / 2));
  root.add(decal(textTexture('IN', 'rgba(240,238,230,0.95)', undefined, 'bold 96px Helvetica, Arial, sans-serif'), 1.6, 1.0, -4.5, G.aisle1.lane, -Math.PI / 2));

  // Walkway along the south wall, stairs and lift doors.
  const walkD = G.southWallZ - G.walkwayZ;
  root.add(box(W, 0.15, walkD, curb, cx, 0.075, G.walkwayZ + walkD / 2));
  root.add(box(W, 0.02, 0.15, yellow, cx, 0.16, G.walkwayZ + 0.075, false));
  const door = new MeshStandardMaterial({ color: '#3d5a78', roughness: 0.5, metalness: 0.3 });
  const steel = new MeshStandardMaterial({ color: '#9aa3ab', roughness: 0.3, metalness: 0.8 });
  root.add(box(1.4, 2.2, 0.06, door, 6, 1.25, G.southWallZ - 0.03), box(1.8, 0.45, 0.05, sign('STAIRS', '#fff', '#24476b', 1.8, 0.45), 6, 2.7, G.southWallZ - 0.04, false));
  root.add(box(1.6, 2.2, 0.06, steel, 14, 1.25, G.southWallZ - 0.03), box(1.6, 0.45, 0.05, sign('LIFT', '#fff', '#24476b', 1.6, 0.45), 14, 2.7, G.southWallZ - 0.04, false));

  // Perimeter. North: open-deck spandrel. South: solid. West: entrance and exit openings. East: ramp opening.
  const t = 0.25;
  root.add(box(W, G.spandrel, t, wall, cx, G.spandrel / 2, G.northWallZ - t / 2));
  root.add(box(W, G.ceiling, t, wall, cx, G.ceiling / 2, G.southWallZ + t / 2));
  const west: [number, number][] = [[G.northWallZ, G.aisle1.z0], [G.aisle1.z1, G.aisle2.z0], [G.aisle2.z1, G.southWallZ]];
  for (const [z0, z1] of west) root.add(box(t, z0 === G.northWallZ ? G.spandrel : G.ceiling, z1 - z0, wall, G.minX + t / 2, (z0 === G.northWallZ ? G.spandrel : G.ceiling) / 2, (z0 + z1) / 2));
  for (const [z0, z1] of [[G.northWallZ, G.ramp.z0], [G.ramp.z1, G.southWallZ]] as [number, number][]) root.add(box(t, G.spandrel, z1 - z0, wall, G.maxX - t / 2, G.spandrel / 2, (z0 + z1) / 2));
  // Ramp to the next level, rising east.
  const ramp = new Mesh(new BoxGeometry(G.ramp.x1 - G.ramp.x0 + 6, 0.25, G.ramp.z1 - G.ramp.z0), slab);
  ramp.position.set((G.ramp.x0 + G.ramp.x1) / 2 + 3, 0.9, (G.ramp.z0 + G.ramp.z1) / 2);
  ramp.rotation.z = 0.2;
  ramp.receiveShadow = true;
  root.add(ramp, box(2.4, 0.5, 0.05, sign('RAMP ↑ LEVEL 2', '#fff', '#24476b', 2.4, 0.5), G.ramp.x0, 3.1, G.ramp.z0 - 0.2, false));
  // Entrance and exit barriers, headroom bars and signs.
  for (const [z, label] of [[G.aisle1.lane, 'ENTRANCE'], [G.aisle2.lane, 'EXIT']] as [number, string][]) {
    root.add(box(0.3, 1.1, 0.3, yellow, G.minX + 1.2, 0.55, z - 3.0));
    const arm = box(0.08, 0.08, 4.6, new MeshStandardMaterial({ color: '#e64040', roughness: 0.5 }), G.minX + 1.2, 1.0, z - 0.6);
    arm.rotation.x = 0;
    root.add(arm);
    root.add(box(0.12, 0.18, 6.8, yellow, G.minX + 0.4, 2.35, z));
    root.add(box(0.05, 0.5, 2.6, sign(label, '#fff', label === 'EXIT' ? '#0f7a3a' : '#24476b', 2.6, 0.5), G.minX + 0.47, 2.85, z, false));
  }
  root.add(box(0.05, 0.4, 2.6, sign('CLEARANCE 2.1 m', '#111', '#e8c53c', 2.6, 0.4, 'bold 48px Helvetica, Arial, sans-serif'), G.minX + 0.47, 2.35, G.aisle1.lane + 2.2, false));

  // Columns with safety-yellow bases.
  for (const [x, z] of G.columns) {
    root.add(box(G.columnSize, G.ceiling, G.columnSize, wall, x, G.ceiling / 2, z));
    root.add(box(G.columnSize + 0.01, 0.9, G.columnSize + 0.01, yellow, x, 0.45, z, false));
  }
  root.add(box(0.5, 0.6, 0.03, sign('5', '#111', '#f2f2f2', 0.5, 0.6, 'bold 160px Helvetica, Arial, sans-serif'), 9.2, 1.9, 18.1 - G.columnSize / 2 - 0.02, false));
  root.add(box(0.6, 0.6, 0.03, sign('P1', '#fff', '#24476b', 0.6, 0.6, 'bold 140px Helvetica, Arial, sans-serif'), 17.6, 2.2, 18.1 + G.columnSize / 2 + 0.02, false));

  // Ceiling, beams, pipes and fixtures (ceiling layer: CAM-0N and shadows see it; the observer's cutaway does not).
  const overhead = new Group();
  overhead.add(box(W, 0.3, D, ceiling, cx, G.ceiling + 0.15, cz));
  for (const z of [0.15, 9.0, 18.1, 27.0, 36.0]) overhead.add(box(W, G.beamDepth, 0.45, ceiling, cx, G.ceiling - G.beamDepth / 2, z));
  for (const z of [4.5, 31.5]) {
    const p = new Mesh(new CylinderGeometry(0.05, 0.05, W, 10), pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(cx, G.ceiling - 0.45, z);
    overhead.add(p);
  }
  overhead.add(box(0.9, 0.34, 0.08, exitSign, -3, G.ceiling - 0.7, G.aisle2.lane));
  const fixtures: PointLight[] = [];
  const spots: [number, number][] = [];
  for (const x of [1.5, 7.5, 13.5, 19.5, 25.5]) spots.push([x, G.aisle1.lane], [x, G.aisle2.lane]);
  spots.push([G.loopX, 14], [G.loopX, 22]);
  for (const [x, z] of spots) {
    overhead.add(box(1.4, 0.06, 0.22, housing, x, G.ceiling - 0.07, z, false));
    overhead.add(box(1.3, 0.03, 0.12, tubes, x, G.ceiling - 0.11, z, false));
    const light = new PointLight('#f3f6ff', 9, 15, 1.6);
    light.position.set(x, G.ceiling - 0.25, z);
    fixtures.push(light);
    root.add(light);
  }
  // CCTV housings where the four cameras hang (the cameras render from just in front of them).
  for (const cam of SHOWCASE_CAMERAS) {
    const [x, y, z] = cam.pose.position;
    // Housing just behind the lens (+z for cameras looking north): back-to-back island cameras
    // must not see each other's housing, so it stays within 0.1 m of the lens on the far side.
    const back = cam.pose.yaw === 0 ? 0.15 : -0.15;
    overhead.add(box(0.18, 0.18, 0.12, dome, x, y + 0.05, z + back, false));
    overhead.add(box(0.05, G.ceiling - y - 0.1, 0.05, housing, x, (G.ceiling + y) / 2 + 0.05, z + back, false));
  }

  // Buildings outside the north openings.
  const windows: MeshStandardMaterial[] = [];
  ([[-12, -20, 18, 18, 12], [12, -26, 16, 26, 14], [38, -20, 14, 16, 14], [72, 14, 12, 22, 20], [-44, 30, 10, 14, 18]] as const).forEach(([x, z, w, h, d], i) => {
    const mat = new MeshStandardMaterial({ color: '#ffffff', map: facadeTexture(`showcase-${i}`, false), roughness: 0.8, emissive: '#000000' });
    mat.map!.repeat.set(w / 6, h / 6);
    windows.push(mat);
    root.add(box(w, h, d, mat, x, h / 2 - 0.6, z, false));
  });

  const sun = new DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(13, 0, 19);
  sun.shadow.camera.layers.enable(CEILING_LAYER);
  const ambient = new HemisphereLight('#ffffff', '#444444', 1);
  setLayerDeep(overhead, CEILING_LAYER);
  root.add(overhead, sun, sun.target, ambient);

  return { root, sun, ambient, fixtures, tubes, exitSign, street, windows };
}
