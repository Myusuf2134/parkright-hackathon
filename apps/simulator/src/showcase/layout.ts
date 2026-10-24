/**
 * The 34-space showcase garage as plain data (no three.js, no DOM): bays, structure,
 * circulation lanes and the four CCTV cameras with their owned bays. The calibration
 * generator, the traffic scheduler, the renderer and the tests all read these numbers.
 *
 * World axes: x east, y up, z south, metres. One covered deck:
 *
 *   z  0.0  north wall
 *      0.4  ── row A (9 bays, open to the south) ──
 *      5.8  ── aisle 1, eastbound (entrance at the west end) ──
 *     12.6  ── row B (8 bays, open to the north) ──
 *     18.0  ── island divider ──
 *     18.2  ── row C (8 bays, open to the south) ──
 *     23.6  ── aisle 2, westbound (exit at the west end) ──
 *     30.4  ── row D (9 bays, open to the north) ──
 *     35.8  walkway (stairs, lift) · 38.6 south wall
 *
 * Aisles join at the east end (x ≈ 24–32), where the ramp to the next level starts.
 */
import type { CameraPose } from '../camera/pose.ts';

export type Vec3 = [number, number, number];
export type Row = 'A' | 'B' | 'C' | 'D';
export type ShowcaseCameraId = 'cam-01' | 'cam-02' | 'cam-03' | 'cam-04';

export interface ShowcaseBay {
  id: string;
  row: Row;
  level: 'L1';
  owner: ShowcaseCameraId;
  /** Floor corners, world metres: NW, NE, SE, SW. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  centre: [number, number];
  width: number;
  depth: number;
  /** Direction from the bay into its aisle: +1 south, −1 north. */
  opensTo: 1 | -1;
}

export const FLOOR_Y = 0.025;
export const BAY_W = 2.6;
export const BAY_PITCH = 2.8;
export const BAY_D = 5.4;
const X0 = 1.0;

const ROWS: Record<Row, { count: number; z0: number; opensTo: 1 | -1; owner: ShowcaseCameraId }> = {
  A: { count: 9, z0: 0.4, opensTo: 1, owner: 'cam-01' },
  B: { count: 8, z0: 12.6, opensTo: -1, owner: 'cam-02' },
  C: { count: 8, z0: 18.2, opensTo: 1, owner: 'cam-03' },
  D: { count: 9, z0: 30.4, opensTo: -1, owner: 'cam-04' },
};

const r3 = (v: number) => +v.toFixed(3);

export const SHOWCASE_BAYS: readonly ShowcaseBay[] = (Object.keys(ROWS) as Row[]).flatMap((row) => {
  const { count, z0, opensTo, owner } = ROWS[row];
  return Array.from({ length: count }, (_, i): ShowcaseBay => {
    const x0 = r3(X0 + BAY_PITCH * i);
    const x1 = r3(x0 + BAY_W);
    const z1 = r3(z0 + BAY_D);
    return {
      id: `${row}${i + 1}`, row, level: 'L1', owner,
      corners: [[x0, FLOOR_Y, z0], [x1, FLOOR_Y, z0], [x1, FLOOR_Y, z1], [x0, FLOOR_Y, z1]],
      centre: [r3(x0 + BAY_W / 2), r3(z0 + BAY_D / 2)],
      width: BAY_W, depth: BAY_D, opensTo,
    };
  });
});

export const SHOWCASE_BAY_IDS = SHOWCASE_BAYS.map((b) => b.id);

export const showcaseBay = (id: string): ShowcaseBay => {
  const bay = SHOWCASE_BAYS.find((b) => b.id === id);
  if (!bay) throw new Error(`unknown bay ${id}`);
  return bay;
};

export const SHOWCASE = {
  minX: -8,
  maxX: 33,
  minZ: -0.3,
  maxZ: 38.9,
  ceiling: 4.2,
  beamDepth: 0.3,
  spandrel: 1.1,
  northWallZ: 0,
  southWallZ: 38.6,
  walkwayZ: 35.8,
  islandZ: [18.0, 18.2] as const,
  islandEndX: 23.6,
  aisle1: { z0: 5.8, z1: 12.6, lane: 9.2 },
  aisle2: { z0: 23.6, z1: 30.4, lane: 27.0 },
  /** East turnaround lane (x) joining the aisles. */
  loopX: 28.4,
  entranceX: -8,
  exitX: -8,
  ramp: { x0: 30.5, x1: 33, z0: 13, z1: 22 },
  columns: [
    ...[0.8, 9.2, 17.6, 26.4].map((x) => [x, 0.15] as [number, number]),
    ...[0.8, 9.2, 17.6].map((x) => [x, 18.1] as [number, number]),
    ...[0.8, 9.2, 17.6, 26.4].map((x) => [x, 36.0] as [number, number]),
  ],
  columnSize: 0.5,
} as const;

export interface ShowcaseCamera {
  id: ShowcaseCameraId;
  label: string;
  row: Row;
  pose: CameraPose;
}

/** Four fixed CCTV cameras, each owning one row and mounted under the beams on the far side of
 * that row's aisle (over the island, or on the north/south walls), looking across at it.
 * Poses from experiments/garage-showcase/camera-search.mjs: zero owned-bay pairs where a parked
 * SUV's 2D box covers >= 45% of a neighbouring owned bay (worst 0.35–0.42), zero cases where a car
 * parked in another row covers an owned bay, every owned bay in frame and >= 82% covered by its car. */
const pose = (position: Vec3, yaw: number, fov: number): CameraPose => ({ position, yaw, pitch: -8, roll: 0, fov, width: 1280, height: 720 });
export const SHOWCASE_CAMERAS: readonly ShowcaseCamera[] = [
  { id: 'cam-01', label: 'CAM-01', row: 'A', pose: pose([13.5, 3.8, 17.9], 0, 66) },
  { id: 'cam-02', label: 'CAM-02', row: 'B', pose: pose([12, 3.8, 0.3], 180, 58) },
  { id: 'cam-03', label: 'CAM-03', row: 'C', pose: pose([12, 3.8, 35.5], 0, 58) },
  { id: 'cam-04', label: 'CAM-04', row: 'D', pose: pose([13.5, 3.8, 18.1], 180, 66) },
];

export const showcaseCamera = (id: string): ShowcaseCamera => {
  const c = SHOWCASE_CAMERAS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown camera ${id}`);
  return c;
};

export const ownedBays = (camera: ShowcaseCameraId) => SHOWCASE_BAYS.filter((b) => b.owner === camera);

export function inShowcaseBay(bay: ShowcaseBay, x: number, z: number): boolean {
  return Math.abs(x - bay.centre[0]) <= bay.width / 2 && Math.abs(z - bay.centre[1]) <= bay.depth / 2;
}
