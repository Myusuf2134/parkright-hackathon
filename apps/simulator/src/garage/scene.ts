/**
 * The garage's static geometry and lights, in plain three.js. Built once; presets only
 * change light and colour values. Everything here is on the world layer (CAM-01 sees it).
 * Only what CAM-01 or the observer can see is modelled.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  type Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from 'three';
import { CEILING_LAYER, setLayerDeep } from '../scene/layers.ts';
import { facadeTexture, surfaceTexture } from '../scene/textures.ts';
import { GARAGE, GARAGE_BAYS } from './layout.ts';
import { GARAGE_PRESETS, type GaragePresetId } from './presets.ts';

export interface GarageHandles {
  root: Group;
  sun: DirectionalLight;
  ambient: HemisphereLight;
  fixtures: PointLight[];
  tubes: MeshStandardMaterial;
  exitSign: MeshStandardMaterial;
  street: MeshStandardMaterial;
  windows: MeshStandardMaterial[];
}

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, cast = true): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** A floor or wall decal with text, drawn once into a canvas. */
function textTexture(text: string, opts: { fg: string; bg?: string; font?: string; w?: number; h?: number }): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = opts.w ?? 256;
  c.height = opts.h ?? 128;
  const ctx = c.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = opts.fg;
  ctx.font = opts.font ?? 'bold 84px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 4);
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

function arrow(mat: MeshStandardMaterial, x: number, z: number, dir: 1 | -1): Mesh {
  const s = new Shape();
  // Pointing +x in shape space (shape x → world x, shape y → world −z after rotation).
  s.moveTo(-1.2, -0.16);
  s.lineTo(0.3, -0.16);
  s.lineTo(0.3, -0.42);
  s.lineTo(1.2, 0);
  s.lineTo(0.3, 0.42);
  s.lineTo(0.3, 0.16);
  s.lineTo(-1.2, 0.16);
  s.closePath();
  const m = new Mesh(new ShapeGeometry(s), mat);
  m.rotation.set(-Math.PI / 2, 0, dir === 1 ? 0 : Math.PI);
  m.position.set(x, 0.021, z);
  m.receiveShadow = true;
  return m;
}

export function buildGarage(): GarageHandles {
  const root = new Group();
  root.name = 'garage';
  const G = GARAGE;
  const W = G.maxX - G.minX;
  const D = G.maxZ - G.minZ;
  const cx = (G.minX + G.maxX) / 2;
  const cz = (G.minZ + G.maxZ) / 2;

  const slabTex = surfaceTexture([132, 131, 126], 22, 'garage-slab', 7);
  const wallTex = surfaceTexture([150, 149, 144], 18, 'garage-wall', 4);
  const ceilTex = surfaceTexture([120, 120, 118], 14, 'garage-ceiling', 5);
  const slab = new MeshStandardMaterial({ color: '#ffffff', map: slabTex, roughness: 0.86, metalness: 0.02 });
  const wall = new MeshStandardMaterial({ color: '#ffffff', map: wallTex, roughness: 0.93 });
  const ceiling = new MeshStandardMaterial({ color: '#ffffff', map: ceilTex, roughness: 0.95, side: DoubleSide });
  const white = new MeshStandardMaterial({ color: '#e9e7de', roughness: 0.55 });
  const yellow = new MeshStandardMaterial({ color: '#d8b13a', roughness: 0.55 });
  const curbMat = new MeshStandardMaterial({ color: '#9a9890', roughness: 0.9 });
  const pipe = new MeshStandardMaterial({ color: '#a8352d', roughness: 0.5, metalness: 0.3 });
  const housing = new MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.4, metalness: 0.5 });
  const tubes = new MeshStandardMaterial({ color: '#ffffff', emissive: '#f3f6ff', emissiveIntensity: 2.2, roughness: 0.3 });
  const exitSign = new MeshStandardMaterial({ color: '#0f7a3a', emissive: '#1fd16a', emissiveIntensity: 1.2, map: textTexture('EXIT', { fg: '#ffffff', bg: '#0f7a3a' }) });
  const street = new MeshStandardMaterial({ color: '#8d8a80', roughness: 0.95 });

  // Slab and the street/ground outside the openings.
  const floor = new Mesh(new PlaneGeometry(W, D), slab);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  const outside = new Mesh(new PlaneGeometry(260, 260), street);
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(cx, -0.6, cz);
  root.add(floor, outside);

  // Bay lines on the 3.0 m pitch (centre of each 0.4 m gap), tick at the aisle end, wheel stops, stencils.
  for (const row of ['A', 'B'] as const) {
    const bays = GARAGE_BAYS.filter((b) => b.row === row);
    const z0 = bays[0]!.corners[0][2];
    const z1 = bays[0]!.corners[2][2];
    const mid = (z0 + z1) / 2;
    for (let i = 0; i <= bays.length; i++) {
      const x = 0.8 + 3 * i;
      root.add(box(0.12, 0.006, z1 - z0, white, x, 0.012, mid, false));
    }
    for (const b of bays) {
      const back = b.opensTo === 1 ? b.corners[0][2] + 0.45 : b.corners[2][2] - 0.45;
      root.add(box(1.7, 0.13, 0.16, curbMat, b.centre[0], 0.065, back));
      const stencilZ = b.opensTo === 1 ? b.corners[0][2] + 1.25 : b.corners[2][2] - 1.25;
      root.add(decal(textTexture(b.id, { fg: 'rgba(235,233,224,0.92)' }), 1.1, 0.55, b.centre[0], stencilZ, b.opensTo === 1 ? 0 : Math.PI));
    }
  }

  // Aisle: dashed yellow centre line, direction arrows, crosswalk at the stair lobby, EXIT stencil.
  for (let x = G.minX + 1; x < G.maxX - 1; x += 3) root.add(box(1.6, 0.006, 0.12, yellow, x + 0.8, 0.012, G.aisle.centre, false));
  for (const x of [2.5, 13.5]) root.add(arrow(white, x, G.aisle.eastLaneZ, 1));
  for (const x of [7.5, 18.5]) root.add(arrow(white, x, G.aisle.westLaneZ, -1));
  for (let k = 0; k < 6; k++) root.add(box(0.45, 0.006, 4.2, white, 20.9 + k * 0.75, 0.012, G.aisle.centre, false));
  root.add(decal(textTexture('EXIT', { fg: 'rgba(240,238,230,0.95)', font: 'bold 96px Helvetica, Arial, sans-serif' }), 2.2, 1.0, 23.4, G.aisle.eastLaneZ, -Math.PI / 2));

  // Walkway behind row B: raised curb and kerb paint.
  const walkZ0 = 18.75;
  const walkD = G.southWallZ - walkZ0;
  root.add(box(W, 0.15, walkD, curbMat, cx, 0.075, walkZ0 + walkD / 2));
  root.add(box(W, 0.02, 0.15, yellow, cx, 0.16, walkZ0 + 0.075, false));

  // Perimeter: north spandrel (open above), east/west spandrels with the aisle openings, solid south wall.
  const t = 0.25;
  root.add(box(W, G.spandrel, t, wall, cx, G.spandrel / 2, G.northWallZ - t / 2));
  for (const [x, dir] of [[G.minX, 1], [G.maxX, -1]] as const) {
    const openZ0 = G.aisle.z0 - 0.6;
    const openZ1 = G.aisle.z1 + 0.6;
    const northLen = openZ0 - G.northWallZ;
    const southLen = G.southWallZ - openZ1;
    root.add(box(t, G.spandrel, northLen, wall, x + (dir * t) / 2, G.spandrel / 2, G.northWallZ + northLen / 2));
    root.add(box(t, G.ceiling, southLen, wall, x + (dir * t) / 2, G.ceiling / 2, openZ1 + southLen / 2));
  }
  root.add(box(W, G.ceiling, t, wall, cx, G.ceiling / 2, G.southWallZ + t / 2));
  // Stair lobby door and sign on the south wall.
  root.add(box(1.4, 2.2, 0.06, new MeshStandardMaterial({ color: '#3d5a78', roughness: 0.5, metalness: 0.3 }), 8.0, 1.1, G.southWallZ - 0.03));
  root.add(box(1.6, 0.4, 0.05, new MeshStandardMaterial({ map: textTexture('STAIRS', { fg: '#ffffff', bg: '#24476b', font: 'bold 64px Helvetica, Arial, sans-serif' }) }), 8.0, 2.55, G.southWallZ - 0.04, false));

  // Columns with a solid safety-yellow base band. (Render adjustment v2: the v1 black/yellow
  // stripes were detected by A2 as vehicles; a solid band is an equally common garage finish.)
  for (const [x, z] of G.columns) {
    root.add(box(G.columnSize, G.ceiling, G.columnSize, wall, x, G.ceiling / 2, z));
    root.add(box(G.columnSize + 0.01, 0.9, G.columnSize + 0.01, yellow, x, 0.45, z, false));
  }

  // Ceiling slab, beams, sprinkler pipes: on the ceiling layer (CAM-01 and shadows see it, the observer's cutaway does not).
  const overhead = new Group();
  overhead.name = 'ceiling';
  overhead.add(box(W, 0.3, D, ceiling, cx, G.ceiling + 0.15, cz));
  for (const z of G.beamsZ) overhead.add(box(W, G.beamDepth, 0.45, ceiling, cx, G.ceiling - G.beamDepth / 2, z));
  for (const [x] of G.columns.slice(0, 3)) overhead.add(box(0.45, G.beamDepth, D, ceiling, x, G.ceiling - G.beamDepth / 2, cz));
  for (const z of [4.4, 15.6]) {
    const p = new Mesh(new CylinderGeometry(0.05, 0.05, W, 10), pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(cx, G.ceiling - 0.45, z);
    overhead.add(p);
  }

  // Entrance headroom bar.
  const bar = box(0.12, 0.18, G.aisle.z1 - G.aisle.z0 + 1, yellow, G.minX + 0.4, 2.35, G.aisle.centre);
  root.add(bar);
  root.add(box(0.05, 0.45, 2.2, new MeshStandardMaterial({ map: textTexture('CLEARANCE 2.1 m', { fg: '#111', bg: '#e8c53c', font: 'bold 40px Helvetica, Arial, sans-serif', w: 512, h: 96 }) }), G.minX + 0.47, 2.75, G.aisle.centre, false));

  // Exit sign hanging over the east end of the aisle; speed sign on a column.
  root.add(box(0.9, 0.34, 0.08, exitSign, G.maxX - 2.5, G.ceiling - 0.7, G.aisle.centre, false));
  root.add(box(0.5, 0.6, 0.03, new MeshStandardMaterial({ map: textTexture('5', { fg: '#111', bg: '#f2f2f2', font: 'bold 96px Helvetica, Arial, sans-serif', w: 128, h: 160 }) }), 9.8, 1.9, 11.95 + G.columnSize / 2 + 0.02, false));

  // Linear LED fixtures: along the aisle and over each row, each with a point light.
  const fixtures: PointLight[] = [];
  const spots: [number, number][] = [];
  for (const x of [1.5, 6.5, 11.5, 16.5, 21.5]) spots.push([x, G.aisle.centre]);
  for (const x of [2.3, 8.3, 14.3]) spots.push([x, 4.4], [x + 3, 15.6]);
  for (const [x, z] of spots) {
    overhead.add(box(1.4, 0.06, 0.22, housing, x, G.ceiling - 0.07, z, false));
    overhead.add(box(1.3, 0.03, 0.12, tubes, x, G.ceiling - 0.11, z, false));
    const light = new PointLight('#f3f6ff', 9, 13, 1.6);
    light.position.set(x, G.ceiling - 0.25, z);
    fixtures.push(light);
    root.add(light);
  }

  // A few buildings outside the north and east openings for depth.
  const windows: MeshStandardMaterial[] = [];
  const blocks: [number, number, number, number, number][] = [
    [-10, -18, 16, 18, 10], [12, -24, 14, 26, 12], [32, -14, 12, 14, 12], [40, 10, 10, 20, 18], [-20, 6, 8, 12, 16],
  ];
  blocks.forEach(([x, z, w, h, d], i) => {
    const mat = new MeshStandardMaterial({ color: '#ffffff', map: facadeTexture(`garage-${i}`, false), roughness: 0.8, emissive: '#000000' });
    mat.map!.repeat.set(w / 6, h / 6);
    windows.push(mat);
    root.add(box(w, h, d, mat, x, h / 2 - 0.6, z, false));
  });

  // Daylight through the openings, sky/ground ambient.
  const sun = new DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(10, 0, 10);
  sun.shadow.camera.layers.enable(CEILING_LAYER);
  const ambient = new HemisphereLight('#ffffff', '#444444', 1);
  setLayerDeep(overhead, CEILING_LAYER);
  root.add(overhead, sun, sun.target, ambient);

  return { root, sun, ambient, fixtures, tubes, exitSign, street, windows };
}

export function applyGaragePreset(id: GaragePresetId, scene: Scene, h: GarageHandles): number {
  const p = GARAGE_PRESETS[id];
  scene.background = new Color(p.sky);
  scene.fog = new Fog(p.haze.color, p.haze.near, p.haze.far);
  const [dx, dy, dz] = p.sun.direction;
  h.sun.position.set(10 + dx * 60, dy * 60, 10 + dz * 60);
  h.sun.color.set(p.sun.color);
  h.sun.intensity = p.sun.intensity;
  h.sun.castShadow = p.sun.shadows;
  h.ambient.color.set(p.ambient.sky);
  h.ambient.groundColor.set(p.ambient.ground);
  h.ambient.intensity = p.ambient.intensity;
  for (const f of h.fixtures) {
    f.color.set(p.fixtures.color);
    f.intensity = p.fixtures.intensity;
  }
  h.tubes.emissive.set(p.fixtures.color);
  h.tubes.emissiveIntensity = p.fixtures.glow;
  h.street.color.set(p.ground);
  const night = id === 'night' || id === 'dusk';
  for (const w of h.windows) {
    w.emissive.set(night ? '#ffcf8a' : '#000000');
    w.emissiveIntensity = id === 'night' ? 0.25 : id === 'dusk' ? 0.1 : 0;
  }
  return p.exposure;
}
