/**
 * The Vision Lab engine, independent of React: world + scene + cam-01.
 *
 * captureFrame() is the one place a camera frame is produced. In a single synchronous
 * step it syncs the scene to the world, renders cam-01, starts JPEG encoding of those
 * pixels, and reads the simulator's ground truth for the same instant. The frame and
 * the truth then leave through two separate modules (stream/ and evaluation/).
 *
 * A future batch renderer can do: new Lab(spec) → attach(new Scene()) → captureFrame().
 */
import { Group, type Scene } from 'three';
import { VirtualCamera } from './camera/virtualCamera.ts';
import { buildDeck, type DeckHandles } from './scene/environment.ts';
import { applyPreset, buildLighting, exposureFor, type Lighting } from './scene/lighting.ts';
import { OperatorOverlays, type OverlayOptions } from './scene/overlays.ts';
import { VehicleLayer } from './scene/vehicleLayer.ts';
import type { PresetId } from './sim/presets.ts';
import type { SceneSpec } from './sim/spec.ts';
import { type TruthSnapshot, World } from './sim/world.ts';

export interface CapturedFrame {
  /** Encoded from cam-01's rendered pixels. */
  jpeg: Blob;
  simTimeMs: number;
  capturedAt: Date;
  /** Simulator ground truth at the same instant. Evaluation only. */
  truth: TruthSnapshot;
}

const PREVIEW_INTERVAL_MS = 1000 / 15;

export class Lab {
  readonly world: World;
  readonly camera: VirtualCamera;
  readonly root = new Group();
  readonly overlays: OperatorOverlays;
  overlayOptions: OverlayOptions = { outlines: false, truth: false, frustum: false };

  private deck: DeckHandles;
  private lighting: Lighting;
  private vehicles = new VehicleLayer();
  private scene: Scene | null = null;
  private appliedPreset: PresetId | null = null;
  private lastPreviewAt = 0;

  constructor(spec?: SceneSpec) {
    this.world = new World(spec);
    this.camera = new VirtualCamera(this.world.spec.camera);
    this.deck = buildDeck();
    this.lighting = buildLighting();
    this.overlays = new OperatorOverlays(this.camera.camera);
    this.root.add(this.deck.root, this.lighting.root, this.vehicles.root, this.overlays.root);
  }

  /** Uses `scene` for sky and fog. Adds the lab's objects unless the caller mounts `root` itself. */
  attach(scene: Scene, addRoot = !this.root.parent): void {
    this.scene = scene;
    if (addRoot) scene.add(this.root);
    this.sync();
  }

  get presetExposure(): number {
    return exposureFor(this.world.spec.preset);
  }

  /** Brings the scene graph in line with the world. Cheap; called before every render. */
  sync(): void {
    if (!this.scene) return;
    const { spec } = this.world;
    if (this.appliedPreset !== spec.preset) {
      applyPreset(spec.preset, this.scene, this.lighting, this.deck);
      this.camera.setExposure(exposureFor(spec.preset));
      this.appliedPreset = spec.preset;
    }
    this.camera.setPose(spec.camera);
    this.vehicles.sync(this.world);
    this.overlays.update(this.world, this.overlayOptions);
  }

  /** Per animation frame: advance time, sync, and refresh the live cam-01 preview. */
  tick(dtMs: number, nowMs: number): void {
    this.world.advance(dtMs);
    this.sync();
    if (this.scene && nowMs - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
      this.camera.render(this.scene);
      this.lastPreviewAt = nowMs;
    }
  }

  async captureFrame(): Promise<CapturedFrame> {
    if (!this.scene) throw new Error('scene not attached');
    this.sync();
    const truth = this.world.truth();
    const capturedAt = new Date();
    const jpeg = await this.camera.capture(this.scene);
    return { jpeg, simTimeMs: truth.simTimeMs, capturedAt, truth };
  }
}
