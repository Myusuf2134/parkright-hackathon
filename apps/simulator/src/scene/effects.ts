/**
 * Adverse-condition effects (rain, fog, snow, sun glare, harsh shadows, lens dirt,
 * partial occlusion, exposure). The extension point for later benchmarking; none are
 * implemented yet. An effect must change the rendered pixels only — it may not add
 * anything that tells perception what is in a bay.
 */
import type { Scene } from 'three';
import type { EffectId } from '../sim/presets.ts';

type Effect = (scene: Scene, intensity: number) => void;

const EFFECTS: Partial<Record<EffectId, Effect>> = {};

export function applyEffects(effects: readonly { id: EffectId; intensity: number }[], scene: Scene): void {
  for (const e of effects) {
    const apply = EFFECTS[e.id];
    if (!apply) throw new Error(`environment effect "${e.id}" is not implemented yet`);
    apply(scene, e.intensity);
  }
}
