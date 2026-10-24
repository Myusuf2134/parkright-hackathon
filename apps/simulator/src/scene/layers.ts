import type { Object3D } from 'three';

/**
 * Render layers. cam-01 renders ONLY the world layer. Everything operator-only (bay
 * outlines, truth tints, the camera frustum) lives on OPERATOR_LAYER, so it can never
 * appear in a perception JPEG. Text labels are DOM elements and never enter WebGL at all.
 */
export const WORLD_LAYER = 0;
export const OPERATOR_LAYER = 1;
/** Garage ceiling: rendered by CAM-01 and cast into shadows, hidden from the observer's cutaway view. */
export const CEILING_LAYER = 2;

export function setLayerDeep(root: Object3D, layer: number): void {
  root.traverse((o) => o.layers.set(layer));
}
