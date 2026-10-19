/**
 * OFFLINE DATASET visibility, measured by rendering — browser only.
 *
 * Two kinds of ID render through cam-01's own PerspectiveCamera into an off-screen,
 * non-antialiased target with flat unlit colours:
 *   1. the full scene, every vehicle in its own colour and everything else black, so a
 *      vehicle's pixels are the ones not hidden by the deck, an occluder or another car;
 *   2. each vehicle alone, giving its unoccluded silhouette inside the frame.
 * visible_fraction = visible / unoccluded. The visible box is the bounding box of the
 * vehicle's visible pixels. These renders never touch cam-01's canvas or any JPEG.
 */
import { Color, LinearSRGBColorSpace, type Material, type Mesh, MeshBasicMaterial, type Object3D, type PerspectiveCamera, type Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Box } from './labels.ts';

export interface Visibility {
  visible_pixels: number;
  unoccluded_pixels: number;
  visible_fraction: number;
  bbox_visible: Box | null;
  occlusion: 'none' | 'partial' | 'heavy' | 'hidden';
}

export const OCCLUSION_RULE = 'none: visible_fraction >= 0.95; partial: >= 0.5; heavy: > 0; hidden: 0 visible pixels';

const STEP = 16; // vehicle i is drawn with red = (i + 1) * 16, green = blue = 0

export function occlusionOf(fraction: number, visible: number): Visibility['occlusion'] {
  if (visible === 0) return 'hidden';
  return fraction >= 0.95 ? 'none' : fraction >= 0.5 ? 'partial' : 'heavy';
}

export class VisibilityRenderer {
  private renderer: WebGLRenderer;
  private target: WebGLRenderTarget;
  private pixels: Uint8Array;
  private black = new MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  private ids: MeshBasicMaterial[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 1);
    this.target = new WebGLRenderTarget(width, height, { samples: 0, depthBuffer: true });
    this.pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < 15; i++) {
      const c = new Color().setRGB(((i + 1) * STEP) / 255, 0, 0, LinearSRGBColorSpace);
      this.ids.push(new MeshBasicMaterial({ color: c, fog: false, toneMapped: false }));
    }
  }

  /**
   * `vehicles` are the scene's vehicle groups in label order. Returns one Visibility per
   * vehicle plus the count of pixels whose colour matched no known ID (should be 0).
   */
  measure(scene: Scene, camera: PerspectiveCamera, vehicles: readonly Object3D[]): { visibility: Visibility[]; stray_pixels: number } {
    if (vehicles.length > this.ids.length) throw new Error('too many vehicles for the ID palette');
    const saved = new Map<Mesh, Material | Material[]>();
    const owner = new Map<Object3D, number>();
    vehicles.forEach((v, i) => v.traverse((o) => owner.set(o, i)));
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      saved.set(mesh, mesh.material);
      const i = owner.get(mesh);
      mesh.material = i === undefined ? this.black : this.ids[i]!;
    });
    const background = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    try {
      const all = this.count(scene, camera, vehicles.length);
      const solo: number[] = [];
      const visibleState = new Map<Object3D, boolean>();
      scene.traverse((o) => visibleState.set(o, o.visible));
      vehicles.forEach((_, i) => {
        // Hide every mesh that is not part of this vehicle (deck, occluders, other cars).
        scene.traverse((o) => {
          if ((o as Mesh).isMesh) o.visible = owner.get(o) === i;
        });
        solo.push(this.count(scene, camera, vehicles.length).counts[i]!);
      });
      for (const [o, v] of visibleState) o.visible = v;
      const visibility = vehicles.map((_, i) => {
        const visible = all.counts[i]!;
        const unoccluded = Math.max(solo[i]!, visible);
        const fraction = unoccluded === 0 ? 0 : Math.round((visible / unoccluded) * 10_000) / 10_000;
        return { visible_pixels: visible, unoccluded_pixels: unoccluded, visible_fraction: fraction, bbox_visible: all.boxes[i]!, occlusion: occlusionOf(fraction, visible) };
      });
      return { visibility, stray_pixels: all.stray };
    } finally {
      for (const [mesh, m] of saved) mesh.material = m;
      scene.background = background;
      scene.fog = fog;
    }
  }

  private count(scene: Scene, camera: PerspectiveCamera, n: number) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, this.width, this.height, this.pixels);
    this.renderer.setRenderTarget(null);
    const counts = new Array<number>(n).fill(0);
    const ext = Array.from({ length: n }, () => [Infinity, Infinity, -Infinity, -Infinity]);
    let stray = 0;
    const px = this.pixels;
    for (let row = 0; row < this.height; row++) {
      const y = this.height - 1 - row; // WebGL rows start at the bottom
      for (let x = 0; x < this.width; x++) {
        const o = (row * this.width + x) * 4;
        const r = px[o]!;
        if (r === 0 && px[o + 1] === 0 && px[o + 2] === 0) continue;
        const id = Math.round(r / STEP) - 1;
        if (id < 0 || id >= n || Math.abs(r - (id + 1) * STEP) > 2 || px[o + 1]! > 2 || px[o + 2]! > 2) {
          stray++;
          continue;
        }
        counts[id]!++;
        const e = ext[id]!;
        if (x < e[0]!) e[0] = x;
        if (y < e[1]!) e[1] = y;
        if (x > e[2]!) e[2] = x;
        if (y > e[3]!) e[3] = y;
      }
    }
    const boxes = ext.map((e, i): Box | null => (counts[i] ? [e[0]!, e[1]!, e[2]! + 1, e[3]! + 1] : null));
    return { counts, boxes, stray };
  }

  dispose(): void {
    this.target.dispose();
    this.renderer.dispose();
  }
}
