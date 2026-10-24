/**
 * The 3D garage's fixed geometry as plain data (no three.js, no DOM), so the calibration
 * generator, tests and the renderer all read the same numbers.
 *
 * World axes: x east, y up, z south, metres. The twelve bays are the canonical facility's
 * bays (packages/shared/fixtures/mvp-facility.json: A1–A6 north row, B1–B6 south row,
 * 2.6 m × 6.0 m, 4.8 m drive aisle), so the backend facility, bay IDs and demo fixture are
 * unchanged. Only the structure around them and the camera differ from the legacy lot.
 */
import type { CameraPose } from '../camera/pose.ts';

export type Vec3 = [number, number, number];

export interface GarageBay {
  id: string;
  row: 'A' | 'B';
  level: 'L1';
  /** Floor corners, world metres, clockwise from above starting north-west. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  centre: [number, number];
  width: number;
  depth: number;
  /** Direction from the bay into the aisle: A row opens south (+z), B row opens north (−z). */
  opensTo: 1 | -1;
}

/** Painted floor height: paint sits just above the slab. */
export const FLOOR_Y = 0.025;

/** Bay grid: 2.6 m wide bays on a 3.0 m pitch (0.4 m painted line zone), 6.0 m deep. Equal to the
 * canonical facility fixture; test/garage.test.ts checks that against mvp-facility.json. */
const BAY_W = 2.6;
const BAY_D = 6.0;
const ROWS = { A: { z0: 1.6, opensTo: 1 }, B: { z0: 12.4, opensTo: -1 } } as const;

export const GARAGE_BAYS: readonly GarageBay[] = (['A', 'B'] as const).flatMap((row) =>
  [0, 1, 2, 3, 4, 5].map((i): GarageBay => {
    const x0 = +(1 + 3 * i).toFixed(3);
    const x1 = +(x0 + BAY_W).toFixed(3);
    const z0 = ROWS[row].z0;
    const z1 = +(z0 + BAY_D).toFixed(3);
    return {
      id: `${row}${i + 1}`,
      row,
      level: 'L1',
      corners: [[x0, FLOOR_Y, z0], [x1, FLOOR_Y, z0], [x1, FLOOR_Y, z1], [x0, FLOOR_Y, z1]],
      centre: [+(x0 + BAY_W / 2).toFixed(3), +(z0 + BAY_D / 2).toFixed(3)],
      width: BAY_W,
      depth: BAY_D,
      opensTo: ROWS[row].opensTo,
    };
  }),
);

export const garageBay = (id: string): GarageBay => {
  const bay = GARAGE_BAYS.find((b) => b.id === id);
  if (!bay) throw new Error(`unknown bay ${id}`);
  return bay;
};

/** Structure. The garage is one level of a covered deck: slab, ceiling, columns, perimeter walls. */
export const GARAGE = {
  minX: -6,
  maxX: 25,
  minZ: -1.2,
  maxZ: 22.6,
  /** Underside of the ceiling slab. */
  ceiling: 4.2,
  /** Perimeter spandrel wall height; above it the deck is open to the outside. */
  spandrel: 1.1,
  /** Back walls behind each row. */
  northWallZ: 0.7,
  /** South wall: a 3.5 m pedestrian walkway runs behind row B to the stair lobby. */
  southWallZ: 21.9,
  /** Drive aisle between the rows (z), and its two lanes. */
  aisle: { z0: 7.6, z1: 12.4, centre: 10, eastLaneZ: 9.0, westLaneZ: 11.0 },
  /** Entrance from the west street, exit to the east ramp, both on the aisle. */
  entranceX: -6,
  exitX: 25,
  columns: [
    [0.6, 8.05], [9.8, 8.05], [18.9, 8.05],
    [0.6, 11.95], [9.8, 11.95], [18.9, 11.95],
  ] as [number, number][],
  columnSize: 0.55,
  beamsZ: [0.7, 8.05, 11.95, 18.6],
  /** Beam depth below the ceiling slab; CAM-01 hangs below the beams. */
  beamDepth: 0.3,
} as const;

/** CAM-01: a CCTV camera bracketed under the beams near the south-west corner of the walkway,
 * looking north-east across both rows. Render adjustment v2 (see docs/3d-garage-simulator.md):
 * chosen by experiments/3d-garage-simulator/camera-geometry.mjs as the pose under the 4.2 m
 * ceiling with the fewest bay pairs where a parked car's 2D box covers >= 45% of a neighbour
 * (7 of 132; v1 at [0, 3.75, 21.5] / yaw -40 / pitch -30 / fov 55 had 11). */
export const GARAGE_CAM01_POSE: CameraPose = {
  position: [3, 3.8, 21.5],
  yaw: -25,
  pitch: -45,
  roll: 0,
  fov: 78,
  width: 1280,
  height: 720,
};

export const GARAGE_CAMERA_ID = 'cam-01';

/** Is the point (x, z) inside the bay's floor rectangle? */
export function inBay(bay: GarageBay, x: number, z: number): boolean {
  return Math.abs(x - bay.centre[0]) <= bay.width / 2 && Math.abs(z - bay.centre[1]) <= bay.depth / 2;
}
