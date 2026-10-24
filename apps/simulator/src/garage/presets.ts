/**
 * Garage lighting presets. The IDs are the simulator's environment preset IDs, so ground
 * truth records keep the same `environment_preset` values as the legacy lot.
 *
 * Inside a covered deck the ceiling fixtures are on in every preset; what changes is the
 * daylight coming in over the perimeter walls and how much the fixtures dominate.
 */
import type { PresetId } from '../sim/presets.ts';

export type GaragePresetId = PresetId;

export interface GaragePreset {
  label: string;
  /** Sky and street seen through the openings. */
  sky: string;
  ground: string;
  /** Daylight entering over the spandrel walls. */
  sun: { direction: [number, number, number]; color: string; intensity: number; shadows: boolean };
  ambient: { sky: string; ground: string; intensity: number };
  /** Ceiling fixtures: light intensity per fixture and the tube's glow. */
  fixtures: { color: string; intensity: number; glow: number };
  exposure: number;
  haze: { color: string; near: number; far: number };
}

export const GARAGE_PRESETS: Record<GaragePresetId, GaragePreset> = {
  clear_day: {
    label: 'Day',
    sky: '#b9d3ea',
    ground: '#8d8a80',
    sun: { direction: [-0.35, 0.55, -0.75], color: '#fff3df', intensity: 4.2, shadows: true },
    ambient: { sky: '#dfe7ee', ground: '#6f6a60', intensity: 1.35 },
    fixtures: { color: '#f3f6ff', intensity: 9, glow: 2.2 },
    exposure: 1.0,
    haze: { color: '#c9d6e1', near: 30, far: 120 },
  },
  overcast: {
    label: 'Overcast',
    sky: '#a9b0b7',
    ground: '#6c6c69',
    sun: { direction: [-0.2, 0.8, -0.5], color: '#e7ebf0', intensity: 1.1, shadows: false },
    ambient: { sky: '#cdd3d9', ground: '#55534f', intensity: 1.25 },
    fixtures: { color: '#f3f6ff', intensity: 10, glow: 2.2 },
    exposure: 1.05,
    haze: { color: '#a5abb1', near: 25, far: 100 },
  },
  dusk: {
    label: 'Dusk',
    sky: '#d9875c',
    ground: '#4a3b33',
    sun: { direction: [-0.9, 0.18, -0.4], color: '#ff9c5e', intensity: 2.2, shadows: true },
    ambient: { sky: '#7a6c8f', ground: '#2e2724', intensity: 0.55 },
    fixtures: { color: '#fff1d6', intensity: 13, glow: 2.6 },
    exposure: 1.05,
    haze: { color: '#a77866', near: 25, far: 100 },
  },
  night: {
    label: 'Night',
    sky: '#060a12',
    ground: '#0b0c10',
    sun: { direction: [0.3, 1, -0.4], color: '#8ea6d6', intensity: 0.05, shadows: false },
    ambient: { sky: '#1b2233', ground: '#07080b', intensity: 0.16 },
    fixtures: { color: '#ffe7c4', intensity: 15, glow: 3.0 },
    exposure: 1.1,
    haze: { color: '#070a10', near: 22, far: 80 },
  },
};

export const GARAGE_PRESET_IDS = Object.keys(GARAGE_PRESETS) as GaragePresetId[];

/** URL names: day / overcast / dusk / night, or the preset IDs themselves. */
export function parseGaragePreset(v: string | null): GaragePresetId | null {
  if (!v) return null;
  if (v === 'day') return 'clear_day';
  return (GARAGE_PRESET_IDS as string[]).includes(v) ? (v as GaragePresetId) : null;
}
