/**
 * The showcase engine: world + 34-space scene + four fixed CCTV cameras (CAM-01…CAM-04).
 *
 * capture(cameraId) is the only place a showcase camera frame is produced: in one synchronous
 * step it syncs the scene to the world, renders that camera, starts JPEG encoding of exactly those
 * pixels, and reads ground truth for the same instant (owned bays only). Ground truth never goes
 * into the frame. The free observer camera is a separate renderer in the UI and is never captured.
 */
import { BufferGeometry, Group, Line, LineBasicMaterial, Scene, Vector3 } from 'three';
import type { GaragePresetId } from '../garage/presets.ts';
import { applyGaragePreset, type GarageHandles } from '../garage/scene.ts';
import { GarageVehicleLayer } from '../garage/vehicles.ts';
import { OPERATOR_LAYER, setLayerDeep } from '../scene/layers.ts';
import { CctvRig } from './cctv.ts';
import { SHOWCASE_BAYS, SHOWCASE_CAMERAS, type ShowcaseCameraId, ownedBays } from './layout.ts';
import { buildShowcaseGarage } from './scene.ts';
import type { ShowcaseScenarioId } from './traffic.ts';
import { ShowcaseWorld, type ShowcaseTruth } from './world.ts';

export interface ShowcaseFrame {
  cameraId: ShowcaseCameraId;
  jpeg: Blob;
  simTimeMs: number;
  capturedAt: Date;
  /** Ground truth for the camera's owned bays at the same instant. Evaluation only. */
  truth: ShowcaseTruth;
  encodeMs: number;
}

const OWNER_COLORS: Record<ShowcaseCameraId, string> = { 'cam-01': '#28e0ff', 'cam-02': '#ffb020', 'cam-03': '#7cff6b', 'cam-04': '#ff6bd5' };

export class ShowcaseLab {
  readonly world: ShowcaseWorld;
  readonly scene = new Scene();
  readonly handles: GarageHandles;
  readonly cctv: CctvRig;
  /** Bay outlines coloured by owning camera (operator layer: observer view only). */
  readonly outlines = new Group();
  exposure = 1;
  fps = 0;
  private vehicles = new GarageVehicleLayer();
  private appliedPreset: GaragePresetId | null = null;
  private frames = 0;
  private fpsStart = 0;

  constructor(scenario: ShowcaseScenarioId = 'live', preset: GaragePresetId = 'clear_day') {
    this.world = new ShowcaseWorld(scenario, preset);
    this.handles = buildShowcaseGarage();
    this.cctv = new CctvRig(SHOWCASE_CAMERAS);
    for (const b of SHOWCASE_BAYS) {
      const pts = [...b.corners, b.corners[0]].map(([x, , z]) => new Vector3(x, 0.05, z));
      this.outlines.add(new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: OWNER_COLORS[b.owner] })));
    }
    setLayerDeep(this.outlines, OPERATOR_LAYER);
    this.scene.add(this.handles.root, this.vehicles.root, this.outlines);
    this.sync();
  }

  /** The 2D canvas holding camera `id`'s last rendered pixels. */
  canvas(id: ShowcaseCameraId): HTMLCanvasElement {
    return this.cctv.canvas(id);
  }

  load(scenario: ShowcaseScenarioId): void {
    this.world.load(scenario);
    this.vehicles.clear();
    this.sync();
  }

  sync(): void {
    const { preset } = this.world.spec;
    if (this.appliedPreset !== preset) {
      this.exposure = applyGaragePreset(preset, this.scene, this.handles);
      this.cctv.setExposure(this.exposure);
      this.appliedPreset = preset;
    }
    this.vehicles.sync(this.world.vehicles());
  }

  /** Advance time and sync; the UI decides which views to render each animation frame. */
  tick(dtMs: number, nowMs: number): void {
    this.world.advance(dtMs);
    this.sync();
    this.frames++;
    if (nowMs - this.fpsStart >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (nowMs - this.fpsStart));
      this.frames = 0;
      this.fpsStart = nowMs;
    }
  }

  render(id: ShowcaseCameraId): void {
    this.cctv.render(id, this.scene);
  }

  async capture(id: ShowcaseCameraId): Promise<ShowcaseFrame> {
    this.sync();
    const truth = this.world.truth(ownedBays(id).map((b) => b.id));
    const capturedAt = new Date();
    const started = performance.now();
    const jpeg = await this.cctv.capture(id, this.scene);
    return { cameraId: id, jpeg, simTimeMs: truth.simTimeMs, capturedAt, truth, encodeMs: performance.now() - started };
  }
}

export { OWNER_COLORS };
