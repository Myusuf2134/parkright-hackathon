/**
 * The MVP facility in world units, derived from the canonical fixture
 * (packages/shared/fixtures/mvp-facility.json). One plan unit = 20 m, so a bay is
 * 2.6 m × 6.0 m and the aisle between rows is 4.8 m. World axes: x east, y up,
 * z south; plan (x, y) → world (x, z).
 */
import type { FacilityConfig } from '@parkright/contracts';
import fixture from '../../../../packages/shared/fixtures/mvp-facility.json';

export const FACILITY = fixture as FacilityConfig;
export const CAMERA_ID = FACILITY.cameras[0]!.camera_id;
export const METERS_PER_PLAN_UNIT = 20;
export const LOT_SIZE = { x: METERS_PER_PLAN_UNIT, z: METERS_PER_PLAN_UNIT };

export interface Bay {
  spaceId: string;
  row: string;
  /** Bay centre, metres. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** +1: the bay opens towards +z (aisle is south of it); -1: opens towards -z. */
  opensTo: 1 | -1;
}

const rowsByZ = [...FACILITY.spaces].sort((a, b) => a.plan.y - b.plan.y);
const midZ = (rowsByZ[0]!.plan.y + rowsByZ[rowsByZ.length - 1]!.plan.y + rowsByZ[rowsByZ.length - 1]!.plan.h) / 2;

export const BAYS: readonly Bay[] = FACILITY.spaces.map((s) => {
  const centreZ = (s.plan.y + s.plan.h / 2) * METERS_PER_PLAN_UNIT;
  return {
    spaceId: s.space_id,
    row: s.space_id.replace(/\d+$/, ''),
    x: (s.plan.x + s.plan.w / 2) * METERS_PER_PLAN_UNIT,
    z: centreZ,
    width: s.plan.w * METERS_PER_PLAN_UNIT,
    depth: s.plan.h * METERS_PER_PLAN_UNIT,
    opensTo: centreZ < midZ * METERS_PER_PLAN_UNIT ? 1 : -1,
  };
});

export const SPACE_IDS: readonly string[] = BAYS.map((b) => b.spaceId);

export const bayById = (id: string): Bay => {
  const bay = BAYS.find((b) => b.spaceId === id);
  if (!bay) throw new Error(`unknown space ${id}`);
  return bay;
};

/** Centre line of the driving aisle, metres. */
export const AISLE_Z = midZ * METERS_PER_PLAN_UNIT;

export function insideBay(bay: Bay, x: number, z: number): boolean {
  return Math.abs(x - bay.x) <= bay.width / 2 && Math.abs(z - bay.z) <= bay.depth / 2;
}
