/**
 * The Ohio Union North Garage-inspired level in plain three.js. Inspired by a campus parking deck,
 * not a model of the real one: every dimension comes from ohio/layout.ts.
 *
 * Realism over the 34-space showcase: a low precast deck (girders on the column lines, double-tee
 * stems between them, sprinkler and conduit runs, a grid of LED fixtures), a column grid that
 * reads in every camera, an open-deck spandrel with cable rails letting daylight in, gated entry
 * and exit with kiosks and clearance bars, a two-way ramp to level 2 cutting through the slab,
 * painted wayfinding (arrows, ENTER/EXIT, STOP, row signs), worn concrete with tyre marks and
 * oil stains, and campus surroundings (streets, sidewalks, trees, lamps, brick buildings).
 *
 * Static geometry is merged per material and repeated parts are instanced, so the larger level
 * costs few draw calls: CCTV frames are rendered on the same 8 GB machine that runs A2.
 * Lighting presets reuse the garage's (garage/presets.ts) through the same handle shape.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GarageHandles } from '../garage/scene.ts';
import { CEILING_LAYER, setLayerDeep } from '../scene/layers.ts';
import { surfaceTexture } from '../scene/textures.ts';
import { rng } from '../sim/prng.ts';
import { BAY_PITCH, MODULE_X0, OHIO, OHIO_BAYS, OHIO_CAMERAS, OHIO_ROWS } from './layout.ts';

/** Collects static geometry per material and emits one merged mesh per material. */
class Batch {
  private parts = new Map<Material, BufferGeometry[]>();
  constructor(private readonly cast: boolean) {}
  add(mat: Material, g: BufferGeometry): void {
    const list = this.parts.get(mat) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    this.parts.set(mat, list);
  }
  box(mat: Material, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): void {
    const g = new BoxGeometry(w, h, d);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    this.add(mat, g);
  }
  /** A flat floor patch (w along x, d along z) at height y, rotated about y. */
  flat(mat: Material, w: number, d: number, x: number, y: number, z: number, rotY = 0): void {
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z);
    this.add(mat, g);
  }
  into(parent: Object3D): void {
    for (const [mat, list] of this.parts) {
      const m = new Mesh(mergeGeometries(list), mat);
      m.castShadow = this.cast;
      m.receiveShadow = true;
      parent.add(m);
    }
    this.parts.clear();
  }
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

const FONT = (px: number) => `bold ${px}px Helvetica, Arial, sans-serif`;
function signMaterial(text: string, fg: string, bg: string, wPx = 512, hPx = 128, px = 72, emissive = false): MeshStandardMaterial {
  const map = canvasTexture(wPx, hPx, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, wPx, hPx);
    ctx.strokeStyle = fg;
    ctx.lineWidth = Math.max(4, hPx * 0.04);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, wPx - 2 * ctx.lineWidth, hPx - 2 * ctx.lineWidth);
    ctx.fillStyle = fg;
    ctx.font = FONT(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, wPx / 2, hPx / 2 + 3);
  });
  return new MeshStandardMaterial({ map, roughness: 0.5, ...(emissive ? { emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.6 } : {}) });
}

/** Floor paint text (transparent background). */
function paintTexture(text: string, px = 96, w = 512, h = 192): CanvasTexture {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = 'rgba(238,236,226,0.92)';
    ctx.font = FONT(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

/** Brick campus facade with limestone bands; the second texture lights some windows at night. */
function brickFacade(key: string, floors: number, bays: number, brick: string): { map: CanvasTexture; emissiveMap: CanvasTexture } {
  const W = 1024;
  const H = 1024;
  const r = rng(7, 'ohio-facade', key);
  const lit: [number, number, number, number][] = [];
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = brick;
    ctx.fillRect(0, 0, W, H);
    // Brick courses.
    for (let y = 0; y < H; y += 8) {
      ctx.fillStyle = 'rgba(40,20,14,0.22)';
      ctx.fillRect(0, y, W, 1);
      for (let x = (y / 8) % 2 ? 0 : 12; x < W; x += 24) {
        ctx.fillRect(x, y, 1, 8);
        ctx.fillStyle = `rgba(${r.int(0, 60)},${r.int(0, 30)},0,${r.range(0.02, 0.1)})`;
        ctx.fillRect(x + 1, y + 1, 22, 6);
        ctx.fillStyle = 'rgba(40,20,14,0.22)';
      }
    }
    const fh = H / floors;
    const bw = W / bays;
    ctx.fillStyle = '#d9d2c0'; // limestone base and floor bands
    ctx.fillRect(0, H - fh * 0.55, W, fh * 0.55);
    for (let f = 0; f < floors; f++) ctx.fillRect(0, f * fh, W, 6);
    for (let f = 0; f < floors - 1; f++) {
      for (let b = 0; b < bays; b++) {
        const x = b * bw + bw * 0.2;
        const y = f * fh + fh * 0.22;
        const w = bw * 0.6;
        const h = fh * 0.58;
        ctx.fillStyle = '#e8e2d2';
        ctx.fillRect(x - 4, y - 4, w + 8, h + 12);
        ctx.fillStyle = r.chance(0.5) ? '#2d3b47' : '#3c4b57';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(220,230,240,0.18)';
        ctx.fillRect(x, y, w * 0.45, h);
        ctx.fillStyle = '#e8e2d2';
        ctx.fillRect(x + w / 2 - 2, y, 4, h);
        if (r.chance(0.4)) lit.push([x, y, w, h]);
      }
    }
  });
  const emissiveMap = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    for (const [x, y, w, h] of lit) ctx.fillRect(x, y, w, h);
  });
  return { map, emissiveMap };
}

function arrowGeometry(len = 2.4, head = 0.85, width = 0.32): ShapeGeometry {
  const s = new Shape();
  const h = len / 2;
  s.moveTo(-h, -width / 2);
  s.lineTo(h - head, -width / 2);
  s.lineTo(h - head, -head / 2);
  s.lineTo(h, 0);
  s.lineTo(h - head, head / 2);
  s.lineTo(h - head, width / 2);
  s.lineTo(-h, width / 2);
  s.closePath();
  return new ShapeGeometry(s);
}
/** A floor arrow at (x, z) pointing along `angle` (0 = east, π/2 = south). */
function floorArrow(b: Batch, mat: Material, x: number, z: number, angle: number, len?: number): void {
  const g = arrowGeometry(len);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-angle);
  g.translate(x, 0.021, z);
  b.add(mat, g);
}

/** Bay numbers: one atlas texture, one merged mesh for all 72 stencils. */
function bayStencils(): Mesh {
  const cols = 8;
  const rows = Math.ceil(OHIO_BAYS.length / cols);
  const cw = 256;
  const ch = 112;
  const tex = canvasTexture(cols * cw, rows * ch, (ctx) => {
    ctx.fillStyle = 'rgba(236,234,224,0.9)';
    ctx.font = FONT(80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    OHIO_BAYS.forEach((b, i) => ctx.fillText(b.id, (i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch / 2 + 4));
  });
  const parts = OHIO_BAYS.map((b, i) => {
    const g = new PlaneGeometry(1.1, 0.48);
    const uv = g.attributes.uv!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (c + uv.getX(k)) / cols, 1 - (r + 1 - uv.getY(k)) / rows);
    g.rotateX(-Math.PI / 2);
    // Read from the aisle: rows opening south face south.
    if (b.opensTo === -1) g.rotateY(Math.PI);
    const z = b.opensTo === 1 ? b.corners[2][2] - 1.2 : b.corners[0][2] + 1.2;
    g.translate(b.centre[0], 0.023, z);
    return g.toNonIndexed();
  });
  const m = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7 }));
  m.receiveShadow = true;
  return m;
}

function instanced(geo: BufferGeometry, mat: Material, matrices: Matrix4[], cast = false): InstancedMesh {
  const m = new InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((x, i) => m.setMatrixAt(i, x));
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
function place<T extends Object3D>(o: T, x: number, y: number, z: number, rotY = 0): T {
  o.position.set(x, y, z);
  o.rotation.y = rotY;
  return o;
}
const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0) => {
  const o = new Object3D();
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.rotation.y = rotY;
  o.updateMatrix();
  return o.matrix.clone();
};

export function buildOhioGarage(): GarageHandles {
  const root = new Group();
  root.name = 'ohio-union-garage';
  const G = OHIO;
  const x0 = G.westWallX;
  const x1 = G.eastWallX;
  const W = x1 - x0;
  const D = G.southWallZ - G.northWallZ;
  const cx = (x0 + x1) / 2;
  const cz = (G.northWallZ + G.southWallZ) / 2;

  // ---- materials ----------------------------------------------------------------------
  const slab = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([128, 127, 121], 24, 'ohio-slab', 14), roughness: 0.88 });
  const lane = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([112, 111, 107], 20, 'ohio-lane', 10), roughness: 0.82, transparent: true, opacity: 0.55, depthWrite: false });
  const concrete = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([158, 156, 149], 20, 'ohio-wall', 6), roughness: 0.92 });
  const soffit = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([136, 135, 130], 14, 'ohio-soffit', 9), roughness: 0.95, side: DoubleSide });
  const white = new MeshStandardMaterial({ color: '#e6e3d8', roughness: 0.6 });
  const yellow = new MeshStandardMaterial({ color: '#d9b23a', roughness: 0.55 });
  const black = new MeshStandardMaterial({ color: '#1d1e20', roughness: 0.6 });
  const joint = new MeshStandardMaterial({ color: '#55554f', roughness: 0.9 });
  const curb = new MeshStandardMaterial({ color: '#a19e95', roughness: 0.9 });
  const sprinkler = new MeshStandardMaterial({ color: '#a8352d', roughness: 0.5, metalness: 0.3 });
  const conduit = new MeshStandardMaterial({ color: '#8f969c', roughness: 0.4, metalness: 0.6 });
  const steel = new MeshStandardMaterial({ color: '#9aa3ab', roughness: 0.35, metalness: 0.75 });
  const housing = new MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.4, metalness: 0.5 });
  const dome = new MeshStandardMaterial({ color: '#1b1d20', roughness: 0.25, metalness: 0.4 });
  const tubes = new MeshStandardMaterial({ color: '#ffffff', emissive: '#f3f6ff', emissiveIntensity: 2.2, roughness: 0.3 });
  const exitSign = new MeshStandardMaterial({ color: '#0f7a3a', emissive: '#1fd16a', emissiveIntensity: 1.2, map: signMaterial('EXIT', '#ffffff', '#0f7a3a', 256, 96, 64).map });
  const street = new MeshStandardMaterial({ color: '#8d8a80', roughness: 0.95 });
  const asphalt = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([62, 63, 66], 16, 'ohio-asphalt', 30), roughness: 0.92 });
  const sidewalk = new MeshStandardMaterial({ color: '#ffffff', map: surfaceTexture([176, 173, 165], 14, 'ohio-sidewalk', 20), roughness: 0.9 });
  const grass = new MeshStandardMaterial({ color: '#5f7a43', roughness: 1 });
  const glass = new MeshStandardMaterial({ color: '#7d93a6', roughness: 0.1, metalness: 0.6, emissive: '#000000' });
  const lamp = new MeshStandardMaterial({ color: '#f5f1e6', emissive: '#000000', roughness: 0.3 });
  const stain = new MeshStandardMaterial({
    map: canvasTexture(256, 256, (ctx) => {
      const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 120);
      g.addColorStop(0, 'rgba(20,18,14,0.55)');
      g.addColorStop(0.6, 'rgba(20,18,14,0.22)');
      g.addColorStop(1, 'rgba(20,18,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }),
    transparent: true, depthWrite: false, roughness: 0.6,
  });
  const tyre = new MeshStandardMaterial({
    map: canvasTexture(64, 512, (ctx) => {
      ctx.clearRect(0, 0, 64, 512);
      for (const x of [10, 54]) {
        const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
        g.addColorStop(0, 'rgba(15,15,15,0)');
        g.addColorStop(0.5, 'rgba(15,15,15,0.35)');
        g.addColorStop(1, 'rgba(15,15,15,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 8, 0, 16, 512);
      }
    }, [1, 8]),
    transparent: true, depthWrite: false, roughness: 0.7,
  });

  const flat = new Batch(false);
  const solid = new Batch(true);

  // ---- floor: slab, worn drive lanes, tyre marks, stains, joints ----------------------
  flat.flat(slab, W, D, cx, 0, cz);
  for (const a of [G.aisle1, G.aisle2]) {
    flat.flat(lane, x1 - x0 - 1, a.z1 - a.z0 - 0.6, cx, 0.004, (a.z0 + a.z1) / 2);
    flat.flat(tyre, 1.9, x1 - x0 - 6, cx + 1, 0.006, a.lane, Math.PI / 2);
  }
  flat.flat(lane, G.spine.x1 - G.spine.x0 - 0.4, G.aisle2.z0 - G.aisle1.z1 + 0.2, G.spine.lane, 0.004, (G.aisle1.z1 + G.aisle2.z0) / 2);
  flat.flat(lane, G.loop.x1 - G.loop.x0 - 0.4, G.aisle2.z1 - G.aisle1.z0, G.loop.lane, 0.004, (G.aisle1.z0 + G.aisle2.z1) / 2);
  const r = rng(7, 'ohio-floor');
  for (const b of OHIO_BAYS) {
    if (!r.chance(0.7)) continue;
    const s = r.range(0.7, 1.5);
    flat.flat(stain, s, s * r.range(0.6, 1), b.centre[0] + r.range(-0.4, 0.4), 0.008, b.centre[1] + r.range(-0.8, 0.8), r.range(0, Math.PI));
  }
  for (const x of [17.6, 50.0]) flat.box(joint, 0.025, 0.004, D - 2.8, x, 0.009, (G.northWallZ + G.walkwayZ) / 2); // expansion joints
  flat.box(joint, W - 1, 0.004, 0.025, cx, 0.009, 18.1);

  // ---- bays: lines, end ticks, wheel stops, stencils ----------------------------------
  for (const row of OHIO_ROWS) {
    for (const module of ['west', 'east'] as const) {
      const bays = OHIO_BAYS.filter((b) => b.row === row && b.module === module);
      const za = bays[0]!.corners[0][2];
      const zb = bays[0]!.corners[2][2];
      for (let i = 0; i <= bays.length; i++) {
        const x = MODULE_X0[module] - 0.1 + BAY_PITCH * i;
        flat.box(white, 0.11, 0.005, zb - za, x, 0.012, (za + zb) / 2);
      }
      for (const b of bays) {
        const back = b.opensTo === 1 ? za + 0.45 : zb - 0.45;
        solid.box(curb, 1.8, 0.13, 0.17, b.centre[0], 0.065, back);
        flat.box(yellow, 1.6, 0.012, 0.172, b.centre[0], 0.131, back);
      }
    }
  }
  root.add(bayStencils());

  // ---- islands ------------------------------------------------------------------------
  const [iz0, iz1] = G.islandZ;
  for (const [a, b] of G.islands) {
    solid.box(curb, b - a, 0.15, iz1 - iz0 + 0.1, (a + b) / 2, 0.075, (iz0 + iz1) / 2);
    solid.box(yellow, 0.4, 0.16, iz1 - iz0 + 0.12, b + 0.0, 0.08, (iz0 + iz1) / 2);
    solid.box(yellow, 0.4, 0.16, iz1 - iz0 + 0.12, a + 0.0, 0.08, (iz0 + iz1) / 2);
  }

  // ---- wayfinding paint -----------------------------------------------------------------
  for (const a of [G.aisle1, G.aisle2]) {
    const dir = a === G.aisle1 ? 0 : Math.PI;
    for (const x of [4, 16, 40, 52]) floorArrow(flat, white, x, a.lane, dir);
    for (let x = -2; x < 64; x += 3) flat.box(yellow, 1.4, 0.005, 0.1, x + 0.7, 0.012, a === G.aisle1 ? a.z1 - 0.9 : a.z0 + 0.9); // dashed edge
  }
  floorArrow(flat, white, G.spine.lane, 15.3, Math.PI / 2, 2.0);
  floorArrow(flat, white, G.loop.lane, 15.0, Math.PI / 2);
  floorArrow(flat, white, G.loop.lane, 21.5, Math.PI / 2);
  floorArrow(flat, white, G.ramp.upLane, 10.6, Math.PI / 2, 1.8);
  const paint = (text: string, w: number, h: number, x: number, z: number, rotY: number, px = 96) => {
    const g = new PlaneGeometry(w, h);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rotY);
    g.translate(x, 0.022, z);
    const m = new Mesh(g, new MeshStandardMaterial({ map: paintTexture(text, px), transparent: true, depthWrite: false, roughness: 0.7 }));
    m.receiveShadow = true;
    root.add(m);
  };
  paint('ENTER', 3.2, 1.2, -1.2, G.aisle1.lane, -Math.PI / 2);
  paint('EXIT', 3.0, 1.2, -1.2, G.aisle2.lane, Math.PI / 2);
  paint('SLOW', 2.6, 1.0, 22.5, G.aisle1.lane, -Math.PI / 2);
  paint('STOP', 2.6, 1.0, G.spine.lane, G.aisle2.z0 - 0.9, Math.PI);
  flat.box(white, G.spine.x1 - G.spine.x0 - 0.6, 0.005, 0.35, G.spine.lane, 0.012, G.aisle2.z0 - 0.25);
  paint('ONE WAY', 3.2, 1.0, G.spine.lane, 20.5, Math.PI, 80);
  // Crosswalks from the drive aisle to the stair and lift lobbies.
  for (const xc of [13.0, 45.4]) for (let k = 0; k < 6; k++) flat.box(white, 0.45, 0.005, G.aisle2.z1 - G.aisle2.z0 - 0.6, xc - 1.9 + k * 0.76, 0.012, G.aisle2.lane);

  // ---- walkway and lobbies ---------------------------------------------------------------
  const walkD = G.southWallZ - G.walkwayZ;
  solid.box(curb, W, 0.15, walkD, cx, 0.075, G.walkwayZ + walkD / 2);
  flat.box(yellow, W, 0.012, 0.16, cx, 0.157, G.walkwayZ + 0.08);
  for (const [xc, label] of [[13.0, 'STAIRS · ELEVATORS'], [45.4, 'STAIRS']] as const) {
    solid.box(glass, 5.2, 2.6, 0.08, xc, 1.45, G.southWallZ - 0.06);
    solid.box(steel, 5.4, 0.12, 0.12, xc, 2.78, G.southWallZ - 0.08);
    root.add(place(new Mesh(new BoxGeometry(3.4, 0.42, 0.04), signMaterial(label, '#ffffff', '#24476b', 1024, 128, 64, true)), xc, 3.1, G.southWallZ - 0.12));
  }

  // ---- perimeter: spandrels with cable rails, gate openings ------------------------------
  const t = 0.25;
  const span = (len: number, x: number, z: number, alongX: boolean) => {
    if (alongX) solid.box(concrete, len, G.spandrel, t, x, G.spandrel / 2, z);
    else solid.box(concrete, t, G.spandrel, len, x, G.spandrel / 2, z);
    for (const y of [1.3, 1.6, 1.9, 2.2, 2.5]) {
      if (alongX) flat.box(steel, len, 0.016, 0.016, x, y, z);
      else flat.box(steel, 0.016, 0.016, len, x, y, z);
    }
  };
  span(W, cx, G.northWallZ - t / 2, true);
  solid.box(concrete, W, G.ceiling, t, cx, G.ceiling / 2, G.southWallZ + t / 2);
  span(D, x1 + t / 2, cz, false);
  // West wall: spandrel between the gates, full height at the stair end.
  for (const [za, zb] of [[G.northWallZ, G.aisle1.z0], [G.aisle1.z1, G.aisle2.z0], [G.aisle2.z1, G.walkwayZ]] as [number, number][]) span(zb - za, x0 - t / 2, (za + zb) / 2, false);
  solid.box(concrete, t, G.ceiling, walkD, x0 - t / 2, G.ceiling / 2, G.walkwayZ + walkD / 2);

  // ---- gates: header girder with signs, clearance bars, kiosks, raised barrier arms ----------
  for (const [z, label, kioskSide] of [[G.entranceZ, 'ENTRANCE', 1], [G.exitZ, 'EXIT', -1]] as [number, string, 1 | -1][]) {
    root.add(place(new Mesh(new BoxGeometry(0.06, 0.55, 3.2), signMaterial(label, '#ffffff', label === 'EXIT' ? '#0f7a3a' : '#24476b', 640, 112, 72, true)), x0 - 0.3, 3.15, z));
    // Clearance bar on chains, outside the gate.
    solid.box(yellow, 0.14, 0.2, 6.4, x0 - 2.6, 2.2, z);
    for (let k = -3; k <= 3; k += 1.5) flat.box(black, 0.15, 0.2, 0.42, x0 - 2.6, 2.2, z + k);
    root.add(place(new Mesh(new BoxGeometry(0.05, 0.36, 2.6), signMaterial("CLEARANCE 7'-0\"", '#111111', '#e8c53c', 900, 128, 70)), x0 - 2.69, 2.62, z));
    const kz = z + kioskSide * 2.9;
    const gx = x0 - 1.3;
    solid.box(curb, 3.0, 0.18, 0.9, gx, 0.09, kz);
    solid.box(steel, 0.5, 1.25, 0.4, gx - 0.6, 0.8, kz);
    solid.box(black, 0.06, 0.32, 0.26, gx - 0.86, 1.15, kz);
    solid.box(yellow, 0.32, 1.05, 0.32, gx + 0.5, 0.62, kz);
    // Barrier arm, raised (cars pass under it): pivot on the post, swung up about x.
    const pivot = place(new Group(), gx + 0.5, 1.12, kz);
    const arm = place(new Mesh(new BoxGeometry(0.07, 0.07, 4.2), new MeshStandardMaterial({ color: '#e64040', roughness: 0.5 })), 0, 0, -kioskSide * 2.1);
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.x = kioskSide * 1.3;
    root.add(pivot);
  }
  root.add(place(new Mesh(new BoxGeometry(0.05, 0.8, 3.6), signMaterial('NORTH GARAGE · LEVEL 1', '#ffffff', '#3a3f45', 1024, 228, 64)), x0 - t - 0.03, 0.55, 3.0));

  // ---- ramp to level 2 (east bay): sloped slab, parapets, divider, paint ----------------------
  const R = G.ramp;
  const len = R.z1 - R.z0;
  const slope = Math.atan2(R.rise, len);
  const ramp = new Group();
  const rampSlab = new Mesh(new BoxGeometry(R.x1 - R.x0, 0.3, Math.hypot(len, R.rise)), slab);
  rampSlab.position.set(0, -0.15, 0);
  rampSlab.receiveShadow = true;
  ramp.add(rampSlab);
  for (const sx of [R.x0, R.x1]) {
    const p = new Mesh(new BoxGeometry(0.25, 1.0, Math.hypot(len, R.rise)), concrete);
    p.position.set(sx - (R.x0 + R.x1) / 2, 0.5, 0);
    p.castShadow = true;
    ramp.add(p);
  }
  const divider = new Mesh(new BoxGeometry(0.3, 0.16, Math.hypot(len, R.rise) - 1), yellow);
  divider.position.set((R.upLane + R.downLane) / 2 - (R.x0 + R.x1) / 2, 0.08, 0);
  ramp.add(divider);
  for (const [text, x, rot] of [['UP', R.upLane, Math.PI], ['DOWN', R.downLane, 0]] as const) {
    const g = new PlaneGeometry(2.2, 0.9);
    g.rotateX(-Math.PI / 2);
    g.rotateY(rot);
    const m = new Mesh(g, new MeshStandardMaterial({ map: paintTexture(text, 110), transparent: true, depthWrite: false }));
    m.position.set(x - (R.x0 + R.x1) / 2, 0.012, -len / 2 + 4);
    ramp.add(m);
  }
  ramp.position.set((R.x0 + R.x1) / 2, R.rise / 2, (R.z0 + R.z1) / 2);
  ramp.rotation.x = -slope;
  root.add(ramp);
  root.add(place(new Mesh(new BoxGeometry(3.6, 0.5, 0.05), signMaterial('▲ RAMP · LEVELS 2–5', '#ffffff', '#24476b', 1024, 140, 76, true)), (R.x0 + R.x1) / 2, 2.62, R.z0 - 0.3));

  // ---- columns (instanced), with safety-yellow bases and row markers ----------------------
  const colGeo = new BoxGeometry(G.columnSize, G.ceiling, G.columnSize);
  const baseGeo = new BoxGeometry(G.columnSize + 0.012, 1.0, G.columnSize + 0.012);
  const cols: Matrix4[] = [];
  const bases: Matrix4[] = [];
  for (const x of G.columnX) for (const z of G.columnZ) {
    if (z === 18.1 && x > 65) continue; // no column inside the ramp
    cols.push(at(x, G.ceiling / 2, z));
    bases.push(at(x, 0.5, z));
  }
  root.add(instanced(colGeo, concrete, cols, true), instanced(baseGeo, yellow, bases));
  for (const x of [9.2, 41.6]) {
    for (const [z, rowLabel] of [[18.1 - G.columnSize / 2 - 0.02, 'B'], [18.1 + G.columnSize / 2 + 0.02, 'C']] as const) {
      const m = new Mesh(new BoxGeometry(0.5, 0.5, 0.03), signMaterial(rowLabel, '#ffffff', '#b8252d', 128, 128, 96));
      m.position.set(x, 1.9, z);
      root.add(m);
    }
  }

  // ---- ceiling: slab, girders, double-tee stems, pipes, fixtures (ceiling layer) -------------
  const overhead = new Group();
  const over = new Batch(false);
  const voidX = R.x0 - 0.15;
  over.box(soffit, voidX - x0, 0.25, D, (x0 + voidX) / 2, G.ceiling + 0.125, cz);
  over.box(soffit, x1 - voidX, 0.25, R.z0 - G.northWallZ, (voidX + x1) / 2, G.ceiling + 0.125, R.z0 / 2);
  over.box(soffit, x1 - voidX, 0.25, G.southWallZ - R.z1, (voidX + x1) / 2, G.ceiling + 0.125, (R.z1 + G.southWallZ) / 2);
  over.box(soffit, x1 - voidX, 0.3, R.z1 - R.z0, (voidX + x1) / 2, 2 * G.ceiling + 0.4, (R.z0 + R.z1) / 2); // level 2's ceiling above the ramp void
  for (const z of G.columnZ) {
    const end = z === G.columnZ[0] ? x1 : voidX; // girders over the ramp would hit climbing cars
    over.box(soffit, end - x0, G.girderDepth, 0.45, (end + x0) / 2, G.ceiling - G.girderDepth / 2, z);
  }
  const stems: Matrix4[] = [];
  // Stems on a 1.2 m pitch from x0 + 0.2: no stem sits directly over a camera (x 13.5 and 45.9).
  for (let x = x0 + 0.2; x < voidX - 0.3; x += G.stemPitch) for (const [za, zb] of [[0.4, 17.85], [18.35, 35.75]] as const) stems.push(at(x, G.ceiling - G.stemDepth / 2, (za + zb) / 2, 1, 1, zb - za));
  overhead.add(instanced(new BoxGeometry(0.16, G.stemDepth, 1), soffit, stems));
  for (const [z, mat, rad] of [[6.4, sprinkler, 0.05], [24.4, sprinkler, 0.05], [12.2, conduit, 0.035], [30.2, conduit, 0.035]] as const) {
    const g = new CylinderGeometry(rad, rad, voidX - x0, 8);
    g.rotateZ(Math.PI / 2);
    g.translate((x0 + voidX) / 2, G.ceiling - G.stemDepth - 0.12, z);
    over.add(mat, g);
  }
  // LED fixtures: a grid over the aisles and bays; a subset are real lights.
  const fixtureAt: [number, number][] = [];
  for (let x = -1.5; x < 64; x += 4.8) for (const z of [3.2, G.aisle1.lane, 15.3, 21.0, G.aisle2.lane, 33.2]) fixtureAt.push([x, z]);
  for (const z of [14.5, 21.5]) fixtureAt.push([G.spine.lane, z], [G.loop.lane, z]);
  overhead.add(instanced(new BoxGeometry(1.25, 0.06, 0.24), housing, fixtureAt.map(([x, z]) => at(x, G.ceiling - G.stemDepth - 0.08, z))));
  overhead.add(instanced(new BoxGeometry(1.15, 0.03, 0.14), tubes, fixtureAt.map(([x, z]) => at(x, G.ceiling - G.stemDepth - 0.12, z))));
  const fixtures: PointLight[] = [];
  const lit: [number, number][] = [];
  for (const x of [3.7, 13.3, 22.9, 37.3, 46.9, 56.5]) lit.push([x, G.aisle1.lane], [x, G.aisle2.lane]);
  lit.push([G.spine.lane, 18.1], [G.loop.lane, 18.1], [-1.5, G.aisle1.lane], [-1.5, G.aisle2.lane]);
  for (const [x, z] of lit) {
    const light = new PointLight('#f3f6ff', 9, 22, 1.5);
    light.position.set(x, G.ceiling - 0.7, z);
    fixtures.push(light);
    root.add(light);
  }
  // Illuminated signs and CCTV housings.
  over.box(exitSign, 0.9, 0.32, 0.08, 2.0, G.ceiling - G.girderDepth - 0.25, G.aisle2.lane);
  for (const row of OHIO_ROWS) {
    for (const [module, xc] of [['west', 13.5], ['east', 45.9]] as const) {
      const first = module === 'west' ? 1 : 10;
      const z = row === 'A' || row === 'B' ? G.aisle1.lane + (row === 'A' ? -2.6 : 2.6) : G.aisle2.lane + (row === 'C' ? -2.6 : 2.6);
      const sign = new Mesh(new BoxGeometry(2.2, 0.42, 0.04), signMaterial(`ROW ${row} · ${first}–${first + 8}`, '#ffffff', '#3a3f45', 768, 146, 70));
      sign.position.set(xc + (module === 'west' ? -6 : 6), G.ceiling - G.girderDepth - 0.28, z);
      if (row === 'B' || row === 'D') sign.rotation.y = Math.PI; // faces the aisle it hangs over
      overhead.add(sign);
    }
  }
  for (const cam of OHIO_CAMERAS) {
    const [x, y, z] = cam.pose.position;
    // Housing just behind the lens, set into the girder face it is mounted on (back-to-back island
    // cameras are separated by the girder, so neither sees the other).
    const back = cam.pose.yaw === 0 ? 0.14 : -0.14;
    over.box(dome, 0.18, 0.16, 0.12, x, y + 0.02, z + back);
    over.box(housing, 0.26, 0.26, 0.03, x, y + 0.02, z + back * 0.62);
  }
  over.into(overhead);

  // ---- outside: campus streets, sidewalks, trees, lamps, brick buildings ---------------------
  const ground = new Mesh(new PlaneGeometry(420, 420), street);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.05, cz);
  ground.receiveShadow = true;
  root.add(ground);
  const out = new Batch(false);
  out.flat(asphalt, 260, 10, cx, -0.03, -11); // street along the north side
  out.flat(asphalt, 10, 260, x0 - 17, -0.03, cz); // street along the west side
  out.flat(asphalt, 12.5, 30, x0 - 6.25, -0.025, cz - 1.5); // driveway to the gates
  out.flat(sidewalk, 260, 5, cx, 0.02, -3.5);
  out.flat(sidewalk, 4.5, 260, x0 - 14.25, 0.02, cz);
  out.flat(grass, 260, 30, cx, -0.035, -32);
  out.flat(grass, 60, 260, x0 - 52, -0.035, cz);
  out.flat(grass, 60, 260, x1 + 30, -0.035, cz);
  for (let x = -60; x < 130; x += 6) out.box(white, 3, 0.004, 0.14, x, -0.02, -11);
  for (let z = -60; z < 100; z += 6) out.box(white, 0.14, 0.004, 3, x0 - 17, -0.02, z);
  for (let k = 0; k < 9; k++) out.box(white, 0.5, 0.004, 4.0, x0 - 21 + k * 1.0, -0.02, -3.5); // crosswalk
  out.into(root);

  const windows: MeshStandardMaterial[] = [lamp, glass];
  ([
    ['academic', -8, -32, 46, 18, 16, 6, 14, '#8a4a36'],
    ['library', 52, -36, 40, 22, 22, 7, 10, '#9a5a42'],
    ['hall', x0 - 44, 14, 20, 26, 46, 8, 9, '#7d4231'],
    ['annex', x1 + 22, 18, 22, 14, 40, 5, 10, '#8f513b'],
  ] as const).forEach(([key, x, z, w, h, d, floors, bays, brick]) => {
    const { map, emissiveMap } = brickFacade(key, floors, bays, brick);
    map.wrapS = emissiveMap.wrapS = RepeatWrapping;
    map.repeat.x = emissiveMap.repeat.x = Math.max(1, Math.round(Math.max(w, d) / 22));
    const mat = new MeshStandardMaterial({ map, emissiveMap, emissive: '#000000', roughness: 0.85 });
    windows.push(mat);
    const b = new Mesh(new BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2 - 0.05, z);
    root.add(b);
    const roof = new Mesh(new BoxGeometry(w + 0.6, 0.6, d + 0.6), new MeshStandardMaterial({ color: '#d6d0bf', roughness: 0.8 }));
    roof.position.set(x, h + 0.25, z);
    root.add(roof);
  });
  // Trees along the sidewalks and lawns (instanced trunks and canopies, seeded colours).
  const tr = rng(7, 'ohio-trees');
  const treeAt: [number, number, number][] = [];
  for (let x = -26; x < 120; x += 8.5) treeAt.push([x + tr.range(-1, 1), -2.4 - tr.range(0, 0.5), tr.range(0.8, 1.2)]);
  for (let z = -18; z < 70; z += 9) treeAt.push([x0 - 25 - tr.range(0, 2), z, tr.range(0.8, 1.2)]);
  for (let z = -4; z < 60; z += 10) treeAt.push([x1 + 8 + tr.range(0, 3), z, tr.range(0.8, 1.3)]);
  const trunks = instanced(new CylinderGeometry(0.16, 0.24, 3.2, 7), new MeshStandardMaterial({ color: '#4b3a2b', roughness: 1 }), treeAt.map(([x, z, s]) => at(x, 1.6 * s, z, s, s, s)));
  const canopyMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
  const canopies = instanced(new IcosahedronGeometry(2.4, 1), canopyMat, treeAt.map(([x, z, s]) => at(x, 4.4 * s, z, s * tr.range(0.9, 1.15), s * tr.range(0.85, 1.05), s * tr.range(0.9, 1.15))));
  treeAt.forEach((_, i) => canopies.setColorAt(i, new Color().setHSL(0.24 + tr.range(-0.04, 0.04), 0.38, 0.27 + tr.range(-0.05, 0.05))));
  root.add(trunks, canopies);
  const lampPoles: Matrix4[] = [];
  const lampHeads: Matrix4[] = [];
  for (let x = -20; x < 110; x += 18) {
    lampPoles.push(at(x, 2.6, -6.4));
    lampHeads.push(at(x, 5.25, -6.4));
  }
  root.add(instanced(new CylinderGeometry(0.07, 0.1, 5.2, 8), steel, lampPoles), instanced(new BoxGeometry(0.5, 0.18, 0.3), lamp, lampHeads));

  // ---- lights ----------------------------------------------------------------------------
  const sun = new DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(cx, 0, cz);
  sun.shadow.camera.layers.enable(CEILING_LAYER);
  const ambient = new HemisphereLight('#ffffff', '#444444', 1);

  flat.into(root);
  solid.into(root);
  setLayerDeep(overhead, CEILING_LAYER);
  for (const o of overhead.children) o.castShadow = true;
  root.add(overhead, sun, sun.target, ambient);

  return { root, sun, ambient, fixtures, tubes, exitSign, street, windows };
}
