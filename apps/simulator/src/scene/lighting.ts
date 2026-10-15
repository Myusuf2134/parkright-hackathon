/** Applies an environment preset to the scene: sky, haze, sun, ambient, lamps, windows, exposure. */
import { Color, DirectionalLight, Fog, Group, HemisphereLight, type Scene, Vector3, type WebGLRenderer } from 'three';
import { PRESETS, type PresetId } from '../sim/presets.ts';
import type { DeckHandles } from './environment.ts';
import { applyEffects } from './effects.ts';

const TARGET = new Vector3(10, 0, 11);

export interface Lighting {
  root: Group;
  sun: DirectionalLight;
  hemisphere: HemisphereLight;
}

export function buildLighting(): Lighting {
  const root = new Group();
  root.name = 'lighting';
  const sun = new DirectionalLight('#ffffff', 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -22;
  s.right = 22;
  s.top = 22;
  s.bottom = -22;
  s.near = 1;
  s.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.copy(TARGET);
  const hemisphere = new HemisphereLight('#ffffff', '#444444', 1);
  root.add(sun, sun.target, hemisphere);
  return { root, sun, hemisphere };
}

export function applyPreset(id: PresetId, scene: Scene, lighting: Lighting, deck: DeckHandles): void {
  const p = PRESETS[id];
  scene.background = new Color(p.sky);
  scene.fog = new Fog(p.haze.color, p.haze.near, p.haze.far);

  const dir = new Vector3(...p.sun.direction).normalize();
  lighting.sun.position.copy(TARGET).addScaledVector(dir, 60);
  lighting.sun.color.set(p.sun.color);
  lighting.sun.intensity = p.sun.intensity;
  lighting.sun.castShadow = p.sun.shadows;
  lighting.sun.shadow.radius = p.sun.shadowSoftness;

  lighting.hemisphere.color.set(p.hemisphere.sky);
  lighting.hemisphere.groundColor.set(p.hemisphere.ground);
  lighting.hemisphere.intensity = p.hemisphere.intensity;

  for (const lamp of deck.lamps) {
    lamp.intensity = p.lamps.intensity;
    lamp.color.set(p.lamps.color);
  }
  deck.lampHeads.emissiveIntensity = p.lamps.intensity > 0 ? 2.5 : 0;
  const windowGlow = p.contract.lighting === 'night' ? 1.4 : p.contract.lighting === 'dusk' ? 0.5 : 0;
  for (const m of deck.windows) m.emissiveIntensity = windowGlow;

  applyEffects(p.effects, scene);
}

/** Renderer settings shared by the operator view and cam-01, so both see the same image. */
export function exposureFor(id: PresetId): number {
  return PRESETS[id].exposure;
}

export function configureRenderer(renderer: WebGLRenderer, id: PresetId): void {
  renderer.toneMappingExposure = exposureFor(id);
}
