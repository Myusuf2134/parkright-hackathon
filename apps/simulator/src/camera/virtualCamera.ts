/**
 * cam-01: a fixed infrastructure camera with its own renderer and canvas.
 *
 *   3D scene ─▶ render(scene) into this canvas ─▶ canvas.toBlob('image/jpeg') ─▶ upload
 *
 * The canvas shown as CAMERA FEED in the lab is this exact canvas, and the JPEG sent to
 * the backend is encoded from it. There is no second, simplified image for AI.
 *
 * The camera only renders WORLD_LAYER; operator overlays live on another layer and
 * labels are DOM elements, so neither can reach these pixels.
 */
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, type Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { type CameraPose, poseEuler } from './pose.ts';
import { WORLD_LAYER } from '../scene/layers.ts';

export const JPEG_QUALITY = 0.85;

export class VirtualCamera {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
  private renderer: WebGLRenderer;
  private pose: CameraPose | null = null;

  constructor(pose: CameraPose) {
    this.canvas = document.createElement('canvas');
    this.canvas.dataset.testid = 'cam-01-canvas';
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.camera.layers.set(WORLD_LAYER);
    this.setPose(pose);
  }

  setPose(pose: CameraPose): void {
    if (this.pose && JSON.stringify(this.pose) === JSON.stringify(pose)) return;
    this.pose = pose;
    this.camera.position.set(...pose.position);
    this.camera.rotation.set(...poseEuler(pose), 'YXZ');
    this.camera.fov = pose.fov;
    this.camera.aspect = pose.width / pose.height;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.setSize(pose.width, pose.height, false);
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  render(scene: Scene): void {
    this.renderer.render(scene, this.camera);
  }

  /** Renders the scene now and encodes exactly those pixels as JPEG. */
  async capture(scene: Scene, quality = JPEG_QUALITY): Promise<Blob> {
    this.render(scene);
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
    );
  }

  get resolution(): [number, number] {
    return [this.canvas.width, this.canvas.height];
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
