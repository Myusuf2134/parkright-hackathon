/**
 * The garage engine: world + scene + CAM-01, independent of React.
 *
 * captureFrame() is the only place a garage camera frame is produced: in one synchronous
 * step it syncs the scene to the world, renders CAM-01, starts JPEG encoding of exactly
 * those pixels, and reads the ground truth for the same instant. The frame and the truth
 * leave through separate modules (stream/frameUpload and evaluation/groundTruth), exactly
 * as in the legacy lab. Operator overlays live on OPERATOR_LAYER; CAM-01 renders only
 * WORLD_LAYER, so they can never reach a perception JPEG.
 */
import { BufferGeometry, Group, Line, LineBasicMaterial, Scene, Vector3 } from 'three';
import { VirtualCamera } from '../camera/virtualCamera.ts';
import { CEILING_LAYER, OPERATOR_LAYER, setLayerDeep } from '../scene/layers.ts';
import { GARAGE_BAYS } from './layout.ts';
import type { GaragePresetId } from './presets.ts';
import { applyGaragePreset, buildGarage, type GarageHandles } from './scene.ts';
import type { ScenarioId } from './scenarios.ts';
import { GarageVehicleLayer } from './vehicles.ts';
import { type GarageTruth, GarageWorld } from './world.ts';

export interface GarageFrame {
  jpeg: Blob;
  simTimeMs: number;
  capturedAt: Date;
  /** Simulator ground truth at the same instant. Evaluation only. */
  truth: GarageTruth;
  /** Milliseconds spent rendering + JPEG-encoding this frame. */
  encodeMs: number;
}

const PREVIEW_INTERVAL_MS = 1000 / 15;

export class GarageLab {
  readonly world: GarageWorld;
  readonly camera: VirtualCamera;
  readonly scene = new Scene();
  readonly handles: GarageHandles;
  readonly outlines = new Group();
  exposure = 1;

  private vehicles = new GarageVehicleLayer();
  private appliedPreset: GaragePresetId | null = null;
  private lastPreviewAt = 0;
  private renderedFrames = 0;
  private fpsWindowStart = 0;
  fps = 0;

  constructor(scenario: ScenarioId = 'static', preset: GaragePresetId = 'clear_day') {
    this.world = new GarageWorld(scenario, preset);
    this.camera = new VirtualCamera(this.world.spec.camera);
    this.camera.canvas.dataset.testid = 'garage-cam-01-canvas';
    this.camera.camera.layers.enable(CEILING_LAYER);
    this.handles = buildGarage();
    this.buildOutlines();
    this.scene.add(this.handles.root, this.vehicles.root, this.outlines);
    this.sync();
  }

  /** Bay outlines for the observer view only (operator layer). */
  private buildOutlines(): void {
    const mat = new LineBasicMaterial({ color: '#28e0ff' });
    for (const b of GARAGE_BAYS) {
      const pts = [...b.corners, b.corners[0]].map(([x, , z]) => new Vector3(x, 0.05, z));
      this.outlines.add(new Line(new BufferGeometry().setFromPoints(pts), mat));
    }
    setLayerDeep(this.outlines, OPERATOR_LAYER);
  }

  load(scenario: ScenarioId, preset?: GaragePresetId): void {
    this.world.load(scenario, preset);
    this.vehicles.clear();
    this.sync();
  }

  sync(): void {
    const { preset } = this.world.spec;
    if (this.appliedPreset !== preset) {
      this.exposure = applyGaragePreset(preset, this.scene, this.handles);
      this.camera.setExposure(this.exposure);
      this.appliedPreset = preset;
    }
    this.vehicles.sync(this.world.vehicles());
  }

  /** Per animation frame: advance time, sync, refresh the CAM-01 preview at 15 fps. */
  tick(dtMs: number, nowMs: number): void {
    this.world.advance(dtMs);
    this.sync();
    if (nowMs - this.lastPreviewAt >= PREVIEW_INTERVAL_MS) {
      this.camera.render(this.scene);
      this.lastPreviewAt = nowMs;
      this.renderedFrames++;
      if (nowMs - this.fpsWindowStart >= 1000) {
        this.fps = Math.round((this.renderedFrames * 1000) / (nowMs - this.fpsWindowStart));
        this.renderedFrames = 0;
        this.fpsWindowStart = nowMs;
      }
    }
  }

  async captureFrame(): Promise<GarageFrame> {
    this.sync();
    const truth = this.world.truth();
    const capturedAt = new Date();
    const started = performance.now();
    const jpeg = await this.camera.capture(this.scene);
    return { jpeg, simTimeMs: truth.simTimeMs, capturedAt, truth, encodeMs: performance.now() - started };
  }
}
