/**
 * Vehicle appearance is a pure function of (seed, space_id, nonce). A scene spec only
 * needs to record which nonce occupies which bay to reproduce every car exactly.
 */
import { rng } from './prng.ts';

export type VehicleKind = 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'van';

export interface VehicleSpec {
  kind: VehicleKind;
  /** Body colour, hex. */
  color: string;
  length: number;
  width: number;
  height: number;
  /** Where in the bay it stopped: lateral offset (m), depth offset (m), yaw error (rad). */
  offsetX: number;
  offsetZ: number;
  yaw: number;
}

const DIMENSIONS: Record<VehicleKind, [number, number, number]> = {
  sedan: [4.7, 1.82, 1.45],
  hatchback: [4.15, 1.76, 1.5],
  suv: [4.85, 1.95, 1.75],
  pickup: [5.35, 1.98, 1.85],
  van: [5.05, 2.0, 2.15],
};

const KINDS: readonly (readonly [VehicleKind, number])[] = [
  ['sedan', 34],
  ['hatchback', 24],
  ['suv', 26],
  ['pickup', 8],
  ['van', 8],
];

/** Roughly the real-world mix of car colours. */
const COLORS: readonly (readonly [string, number])[] = [
  ['#e9eaec', 24], // white
  ['#16181b', 20], // black
  ['#a7abb0', 15], // silver
  ['#5c6066', 15], // grey
  ['#1f3d73', 8], // blue
  ['#8e1b1f', 7], // red
  ['#2c4a3a', 3], // green
  ['#b9a88a', 3], // beige
  ['#c9772b', 2], // orange
  ['#4b2f2a', 3], // brown
];

export function generateVehicle(seed: number, spaceId: string, nonce: number): VehicleSpec {
  const r = rng(seed, 'vehicle', spaceId, nonce);
  const kind = r.weighted(KINDS);
  const [length, width, height] = DIMENSIONS[kind];
  const scale = r.range(0.97, 1.03);
  return {
    kind,
    color: r.weighted(COLORS),
    length: length * scale,
    width: width * scale,
    height: height * r.range(0.98, 1.02),
    offsetX: r.range(-0.18, 0.18),
    offsetZ: r.range(-0.25, 0.25),
    yaw: r.range(-0.035, 0.035),
  };
}
