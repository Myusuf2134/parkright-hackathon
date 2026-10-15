/**
 * Environment presets. Each maps to the canonical EnvironmentPreset contract (sent with
 * ground truth for evaluation) and to rendering parameters.
 *
 * `effects` is the extension point for adverse conditions (rain, fog, snow, glare, lens
 * dirt, occlusion, exposure). None are implemented yet; see src/scene/effects.ts.
 */
import type { EnvironmentPreset } from '@parkright/contracts';

export type EffectId = 'rain' | 'fog' | 'snow' | 'sun_glare' | 'harsh_shadows' | 'lens_dirt' | 'partial_occlusion' | 'low_exposure' | 'high_exposure';

export interface PresetDefinition {
  contract: EnvironmentPreset;
  sky: string;
  /** Distance fog for depth (atmosphere, not the `fog` weather effect). */
  haze: { color: string; near: number; far: number };
  sun: { direction: [number, number, number]; color: string; intensity: number; shadows: boolean; shadowSoftness: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  /** Pole lamps: 0 = off. */
  lamps: { intensity: number; color: string };
  exposure: number;
  effects: readonly { id: EffectId; intensity: number }[];
}

const preset = (id: string, name: string, lighting: EnvironmentPreset['lighting'], weather: EnvironmentPreset['weather'], intensity: number) => ({
  preset_id: id,
  name,
  lighting,
  weather,
  intensity,
});

export const PRESETS = {
  clear_day: {
    contract: preset('clear_day', 'Clear Day', 'day', 'clear', 0),
    sky: '#9cc4e8',
    haze: { color: '#b9d2e6', near: 60, far: 220 },
    sun: { direction: [-0.45, 1, 0.35], color: '#fff4e0', intensity: 3.6, shadows: true, shadowSoftness: 1.5 },
    hemisphere: { sky: '#d8e8f8', ground: '#8a8274', intensity: 1.5 },
    lamps: { intensity: 0, color: '#ffd9a0' },
    exposure: 1.0,
    effects: [],
  },
  overcast: {
    contract: preset('overcast', 'Overcast', 'day', 'overcast', 0.6),
    sky: '#aab1b8',
    haze: { color: '#a9b0b6', near: 40, far: 160 },
    sun: { direction: [-0.2, 1, 0.15], color: '#e9edf2', intensity: 0.7, shadows: true, shadowSoftness: 8 },
    hemisphere: { sky: '#d5dbe1', ground: '#5b5a57', intensity: 1.9 },
    lamps: { intensity: 0, color: '#ffd9a0' },
    exposure: 1.0,
    effects: [],
  },
  dusk: {
    contract: preset('dusk', 'Dusk', 'dusk', 'clear', 0.5),
    sky: '#d98a5f',
    haze: { color: '#b5806a', near: 35, far: 150 },
    sun: { direction: [-1, 0.16, 0.25], color: '#ff9a5a', intensity: 1.6, shadows: true, shadowSoftness: 3 },
    hemisphere: { sky: '#7a6c8f', ground: '#3b2f2a', intensity: 0.55 },
    lamps: { intensity: 18, color: '#ffc77a' },
    exposure: 1.05,
    effects: [],
  },
  night: {
    contract: preset('night', 'Night', 'night', 'clear', 0.9),
    sky: '#070b14',
    haze: { color: '#0b1018', near: 25, far: 110 },
    sun: { direction: [0.3, 1, -0.4], color: '#8ea6d6', intensity: 0.12, shadows: false, shadowSoftness: 4 },
    hemisphere: { sky: '#1a2438', ground: '#08090c', intensity: 0.22 },
    lamps: { intensity: 60, color: '#ffd29a' },
    exposure: 1.15,
    effects: [],
  },
} as const satisfies Record<string, PresetDefinition>;

export type PresetId = keyof typeof PRESETS;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];
export const isPresetId = (v: string): v is PresetId => v in PRESETS;
