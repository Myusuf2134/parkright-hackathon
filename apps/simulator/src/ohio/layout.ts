/**
 * "Ohio Union North Garage-inspired simulation": one large level of a campus parking deck, as
 * plain data (no three.js, no DOM). INSPIRED BY, not a survey of, the real garage: the bay count,
 * dimensions, column grid, ramps and camera positions are invented for the simulation. It is not
 * an official or exact digital twin and carries no real OSU data.
 *
 * World axes: x east, y up, z south, metres. Two parking modules either side of a central
 * cross aisle (the spine), the ramp bay on the east side:
 *
 *   z  0.0  north wall: open-deck spandrel, campus street beyond
 *      0.4  ── row A (A1–A9 west · spine · A10–A18 east), open to the south ──
 *      5.8  ── aisle 1, eastbound (entrance gate at the west wall) ──
 *     12.6  ── row B (B1–B9 · B10–B18), open to the north ──
 *     18.0  ── island (column line) ──
 *     18.2  ── row C (C1–C9 · C10–C18), open to the south ──
 *     23.6  ── aisle 2, westbound (exit gate at the west wall) ──
 *     30.4  ── row D (D1–D9 · D10–D18), open to the north ──
 *     35.8  walkway (stairs, lifts) · 38.6 south wall
 *
 *   x −4 west wall (gates) · 1.0–26.0 west module · 26.4–33.0 spine (southbound) ·
 *     33.4–58.4 east module · 59–65 east turnaround (southbound) · 65.6–72.4 ramp bay · 73 east wall
 *
 * 72 bays, 8 fixed CCTV cameras; each camera owns one half-row of 9 bays exclusively.
 */
import type { CameraPose } from '../camera/pose.ts';
import type { SiteBay, Vec3 } from '../showcase/schedule.ts';

export type OhioRow = 'A' | 'B' | 'C' | 'D';
export type OhioCameraId = 'cam-01' | 'cam-02' | 'cam-03' | 'cam-04' | 'cam-05' | 'cam-06' | 'cam-07' | 'cam-08';
export type OhioModule = 'west' | 'east';

export interface OhioBay extends SiteBay {
  row: OhioRow;
  owner: OhioCameraId;
  module: OhioModule;
}

export const FLOOR_Y = 0.025;
export const BAY_W = 2.6;
export const BAY_PITCH = 2.8;
export const BAY_D = 5.4;
export const BAYS_PER_HALF_ROW = 9;
/** First bay's west edge in each module. */
export const MODULE_X0: Record<OhioModule, number> = { west: 1.0, east: 33.4 };

const ROWS: Record<OhioRow, { z0: number; opensTo: 1 | -1; owners: Record<OhioModule, OhioCameraId> }> = {
  A: { z0: 0.4, opensTo: 1, owners: { west: 'cam-01', east: 'cam-05' } },
  B: { z0: 12.6, opensTo: -1, owners: { west: 'cam-02', east: 'cam-06' } },
  C: { z0: 18.2, opensTo: 1, owners: { west: 'cam-03', east: 'cam-07' } },
  D: { z0: 30.4, opensTo: -1, owners: { west: 'cam-04', east: 'cam-08' } },
};
export const OHIO_ROWS = Object.keys(ROWS) as OhioRow[];

const r3 = (v: number) => +v.toFixed(3);

/** Row-major: A1…A18, B1…B18, C1…C18, D1…D18 (1–9 west of the spine, 10–18 east). */
export const OHIO_BAYS: readonly OhioBay[] = OHIO_ROWS.flatMap((row) => {
  const { z0, opensTo, owners } = ROWS[row];
  return (['west', 'east'] as const).flatMap((module) =>
    Array.from({ length: BAYS_PER_HALF_ROW }, (_, i): OhioBay => {
      const x0 = r3(MODULE_X0[module] + BAY_PITCH * i);
      const x1 = r3(x0 + BAY_W);
      const z1 = r3(z0 + BAY_D);
      const n = (module === 'west' ? 0 : BAYS_PER_HALF_ROW) + i + 1;
      return {
        id: `${row}${n}`, row, level: 'L1', owner: owners[module], module,
        corners: [[x0, FLOOR_Y, z0], [x1, FLOOR_Y, z0], [x1, FLOOR_Y, z1], [x0, FLOOR_Y, z1]],
        centre: [r3(x0 + BAY_W / 2), r3(z0 + BAY_D / 2)],
        width: BAY_W, depth: BAY_D, opensTo,
      };
    }),
  );
});

export const ohioBay = (id: string): OhioBay => {
  const bay = OHIO_BAYS.find((b) => b.id === id);
  if (!bay) throw new Error(`unknown bay ${id}`);
  return bay;
};

/** Structure and circulation. A low deck: the slab soffit is 3.5 m, girders hang to 2.9 m. */
export const OHIO = {
  westWallX: -4,
  eastWallX: 73,
  northWallZ: 0,
  southWallZ: 38.6,
  walkwayZ: 35.8,
  /** Underside of the slab (level 2's floor). */
  ceiling: 3.5,
  /** Precast girders on the column lines (along x) and double-tee stems between them (along z). */
  girderDepth: 0.6,
  stemDepth: 0.42,
  stemPitch: 1.2,
  spandrel: 1.05,
  islandZ: [18.0, 18.2] as const,
  islands: [[0.4, 26.0], [33.4, 58.4]] as const,
  aisle1: { z0: 5.8, z1: 12.6, lane: 9.2 },
  aisle2: { z0: 23.6, z1: 30.4, lane: 27.0 },
  /** Central cross aisle, one-way southbound from aisle 1 to aisle 2. */
  spine: { x0: 26.4, x1: 33.0, lane: 29.7 },
  /** East turnaround, southbound. */
  loop: { x0: 59.0, x1: 65.0, lane: 62.0 },
  /** Two-way ramp to level 2 in the east bay: foot at z0 (floor), top at z1 (level 2's floor, the slab top). */
  ramp: { x0: 65.6, x1: 72.4, z0: 12.0, z1: 36.0, rise: 3.75, upLane: 67.3, downLane: 70.7 },
  /** Column grid: x lines (every three bays, at the spine and the ramp bay) × z lines. */
  columnX: [0.8, 9.2, 17.6, 26.2, 33.2, 41.6, 50.0, 58.6, 65.3, 72.7],
  columnZ: [0.15, 18.1, 36.0],
  columnSize: 0.55,
  entranceZ: 9.2,
  exitZ: 27.0,
} as const;

/** Ramp height at (x, z): the ramp surface between its foot and top, level 1 elsewhere. */
export function ohioElevation(x: number, z: number): number {
  const R = OHIO.ramp;
  if (x < R.x0 || x > R.x1 || z <= R.z0) return 0;
  return R.rise * Math.min(1, (z - R.z0) / (R.z1 - R.z0));
}

export interface OhioCamera {
  id: OhioCameraId;
  label: string;
  row: OhioRow;
  module: OhioModule;
  /** Short human description of where the camera hangs. */
  mount: string;
  pose: CameraPose;
}

/** Eight fixed CCTV cameras, each owning one half-row and hung 2.8 m up under a girder on the far
 * side of that row's aisle, looking across at it (the 34-space showcase's proven arrangement, at
 * this low deck's mounting height). Checked by experiments/ohio-union-garage/camera-search.mjs:
 * zero owned-bay pairs where a parked SUV's 2D box covers >= 45% of a neighbouring owned bay
 * (worst 0.43), zero cases where a car parked in a bay the camera does not own covers an owned bay
 * (worst 0.34), every owned bay in frame and >= 84% covered by its own car. */
const pose = (position: Vec3, yaw: number, pitch: number, fov: number): CameraPose => ({ position, yaw, pitch, roll: 0, fov, width: 1280, height: 720 });
export const CAMERA_HEIGHT = 2.8;
export const OHIO_CAMERAS: readonly OhioCamera[] = [
  { id: 'cam-01', label: 'CAM-01', row: 'A', module: 'west', mount: 'under the west island girder, facing north', pose: pose([13.5, CAMERA_HEIGHT, 17.8], 0, -8, 62) },
  { id: 'cam-02', label: 'CAM-02', row: 'B', module: 'west', mount: 'under the north girder, facing south', pose: pose([13.5, CAMERA_HEIGHT, 0.45], 180, -8, 62) },
  { id: 'cam-03', label: 'CAM-03', row: 'C', module: 'west', mount: 'under the south girder, facing north', pose: pose([13.5, CAMERA_HEIGHT, 35.7], 0, -8, 62) },
  { id: 'cam-04', label: 'CAM-04', row: 'D', module: 'west', mount: 'under the west island girder, facing south', pose: pose([13.5, CAMERA_HEIGHT, 18.4], 180, -8, 62) },
  { id: 'cam-05', label: 'CAM-05', row: 'A', module: 'east', mount: 'under the east island girder, facing north', pose: pose([45.9, CAMERA_HEIGHT, 17.8], 0, -8, 62) },
  { id: 'cam-06', label: 'CAM-06', row: 'B', module: 'east', mount: 'under the north girder, facing south', pose: pose([45.9, CAMERA_HEIGHT, 0.45], 180, -8, 62) },
  { id: 'cam-07', label: 'CAM-07', row: 'C', module: 'east', mount: 'under the south girder, facing north', pose: pose([45.9, CAMERA_HEIGHT, 35.7], 0, -8, 62) },
  { id: 'cam-08', label: 'CAM-08', row: 'D', module: 'east', mount: 'under the east island girder, facing south', pose: pose([45.9, CAMERA_HEIGHT, 18.4], 180, -8, 62) },
];

export const ohioCamera = (id: string): OhioCamera => {
  const c = OHIO_CAMERAS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown camera ${id}`);
  return c;
};

export const ohioOwnedBays = (camera: string) => OHIO_BAYS.filter((b) => b.owner === camera);
