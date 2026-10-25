/**
 * The showcase CCTV cameras (four or eight, by site) share ONE WebGL renderer (one GPU context, one copy of every
 * texture and shadow map); on an 8 GB machine four separate contexts plus the observer pushed
 * the system into swapping. Each camera has its own fixed PerspectiveCamera and its own 2D canvas:
 *
 *   render(id): render the scene from camera id → copy those pixels into id's canvas
 *   capture(id): render(id) → JPEG-encode id's canvas (exactly the pixels just rendered)
 *
 * Rendering is synchronous, so the pixels copied into a camera's canvas are always that camera's.
 * Only WORLD_LAYER and CEILING_LAYER are rendered: operator overlays never reach a CCTV frame.
 */
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, type Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { type CameraPose, poseEuler } from '../camera/pose.ts';
import { JPEG_QUALITY } from '../camera/virtualCamera.ts';
import { CEILING_LAYER, WORLD_LAYER } from '../scene/layers.ts';

interface Cctv {
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class CctvRig {
  private renderer: WebGLRenderer;
  private cams = new Map<string, Cctv>();
  readonly width: number;
  readonly height: number;

  constructor(poses: readonly { id: string; pose: CameraPose }[]) {
    this.width = poses[0]!.pose.width;
    this.height = poses[0]!.pose.height;
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    for (const { id, pose } of poses) {
      if (pose.width !== this.width || pose.height !== this.height) throw new Error('all CCTV cameras share one resolution');
      const camera = new PerspectiveCamera(pose.fov, pose.width / pose.height, 0.1, 400);
      camera.position.set(...pose.position);
      camera.rotation.set(...poseEuler(pose), 'YXZ');
      camera.layers.set(WORLD_LAYER);
      camera.layers.enable(CEILING_LAYER);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const canvas = document.createElement('canvas');
      canvas.width = pose.width;
      canvas.height = pose.height;
      canvas.dataset.testid = `${id}-canvas`;
      this.cams.set(id, { camera, canvas, ctx: canvas.getContext('2d')! });
    }
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  canvas(id: string): HTMLCanvasElement {
    return this.cams.get(id)!.canvas;
  }

  render(id: string, scene: Scene): void {
    const c = this.cams.get(id)!;
    this.renderer.render(scene, c.camera);
    c.ctx.drawImage(this.renderer.domElement, 0, 0);
  }

  /** Renders camera `id` now and encodes exactly those pixels as JPEG. */
  async capture(id: string, scene: Scene, quality = JPEG_QUALITY): Promise<Blob> {
    this.render(id, scene);
    const { canvas } = this.cams.get(id)!;
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality));
  }
}
