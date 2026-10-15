/**
 * Operator-only overlays on OPERATOR_LAYER: bay outlines (optionally tinted by
 * simulator ground truth) and cam-01's frustum. cam-01 never renders this layer.
 */
import { BufferGeometry, CameraHelper, Color, Group, LineBasicMaterial, LineLoop, type PerspectiveCamera, Vector3 } from 'three';
import { BAYS } from '../sim/facility.ts';
import type { World } from '../sim/world.ts';
import { OPERATOR_LAYER, setLayerDeep } from './layers.ts';

export interface OverlayOptions {
  outlines: boolean;
  truth: boolean;
  frustum: boolean;
}

const NEUTRAL = new Color('#38bdf8');
const OCCUPIED = new Color('#f43f5e');
const EMPTY = new Color('#22c55e');
const SELECTED = new Color('#facc15');

export class OperatorOverlays {
  readonly root = new Group();
  private outlines = new Map<string, LineLoop>();
  private frustum: CameraHelper;

  constructor(cam01: PerspectiveCamera) {
    this.root.name = 'operator-overlays';
    for (const b of BAYS) {
      const pts = [
        new Vector3(b.x - b.width / 2, 0.05, b.z - b.depth / 2),
        new Vector3(b.x + b.width / 2, 0.05, b.z - b.depth / 2),
        new Vector3(b.x + b.width / 2, 0.05, b.z + b.depth / 2),
        new Vector3(b.x - b.width / 2, 0.05, b.z + b.depth / 2),
      ];
      const loop = new LineLoop(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: NEUTRAL, depthTest: false, transparent: true }));
      loop.renderOrder = 10;
      this.outlines.set(b.spaceId, loop);
      this.root.add(loop);
    }
    this.frustum = new CameraHelper(cam01);
    this.root.add(this.frustum);
    setLayerDeep(this.root, OPERATOR_LAYER);
  }

  update(world: World, options: OverlayOptions): void {
    const truth = options.truth ? new Map(world.truth().spaces.map((s) => [s.space_id, s.truth])) : null;
    for (const [id, loop] of this.outlines) {
      loop.visible = options.outlines || options.truth || world.selected === id;
      const mat = loop.material as LineBasicMaterial;
      mat.color.copy(world.selected === id ? SELECTED : truth ? (truth.get(id) === 'occupied' ? OCCUPIED : EMPTY) : NEUTRAL);
      mat.opacity = world.selected === id ? 1 : 0.85;
    }
    this.frustum.visible = options.frustum;
    this.frustum.update();
  }
}
