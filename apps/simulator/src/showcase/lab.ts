/**
 * The showcase engine: world + a site's scene (the 34-space garage or the Ohio Union North
 * Garage-inspired level) + that site's fixed CCTV cameras (CAM-01…CAM-04 or CAM-01…CAM-08).
 *
 * capture(cameraId) is the only place a showcase camera frame is produced: in one synchronous
 * step it syncs the scene to the world, renders that camera, starts JPEG encoding of exactly those
 * pixels, and reads ground truth for the same instant (owned bays only). Ground truth never goes
 * into the frame. The free observer camera is a separate renderer in the UI and is never captured.
 */
import { BufferGeometry, Fog, Group, Line, LineBasicMaterial, Scene, Vector3 } from 'three';
import type { GaragePresetId } from '../garage/presets.ts';
import { applyGaragePreset, type GarageHandles } from '../garage/scene.ts';
import { GarageVehicleLayer } from '../garage/vehicles.ts';
import { OPERATOR_LAYER, setLayerDeep } from '../scene/layers.ts';
import { buildOhioGarage } from '../ohio/scene.ts';
import { CctvRig } from './cctv.ts';
import type { ShowcaseScenarioId } from './schedule.ts';
import { buildShowcaseGarage } from './scene.ts';
import { SHOWCASE_SITE, type Site, type SiteId } from './site.ts';
import { ShowcaseWorld, type ShowcaseTruth } from './world.ts';

type ShowcaseCameraId = string;
const SCENES: Record<SiteId, () => GarageHandles> = { 'showcase-34': buildShowcaseGarage, 'ohio-union': buildOhioGarage };

export interface ShowcaseFrame {
  cameraId: ShowcaseCameraId;
  jpeg: Blob;
  simTimeMs: number;
  capturedAt: Date;
  /** Ground truth for the camera's owned bays at the same instant. Evaluation only. */
  truth: ShowcaseTruth;
  encodeMs: number;
}

const OWNER_COLORS = SHOWCASE_SITE.ownerColors;

export class ShowcaseLab {
  readonly world: ShowcaseWorld;
  readonly scene = new Scene();
  readonly handles: GarageHandles;
  readonly cctv: CctvRig;
  /** Bay outlines coloured by owning camera (operator layer: observer view only). */
  readonly outlines = new Group();
  exposure = 1;
  fps = 0;
  private vehicles: GarageVehicleLayer;
  private appliedPreset: GaragePresetId | null = null;
  private frames = 0;
  private fpsStart = 0;

  constructor(scenario: ShowcaseScenarioId = 'live', preset: GaragePresetId = 'clear_day', readonly site: Site = SHOWCASE_SITE) {
    this.world = new ShowcaseWorld(scenario, preset, 4242, site);
    this.handles = SCENES[site.id]();
    this.cctv = new CctvRig(site.cameras);
    this.vehicles = new GarageVehicleLayer(site.elevation);
    for (const b of site.bays) {
      const pts = [...b.corners, b.corners[0]].map(([x, , z]) => new Vector3(x, 0.05, z));
      this.outlines.add(new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: site.ownerColors[b.owner] })));
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
      const k = this.site.fogScale;
      if (k && this.scene.fog instanceof Fog) Object.assign(this.scene.fog, { near: this.scene.fog.near * k, far: this.scene.fog.far * k });
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
    const truth = this.world.truth(this.site.bays.filter((b) => b.owner === id).map((b) => b.id));
    const capturedAt = new Date();
    const started = performance.now();
    const jpeg = await this.cctv.capture(id, this.scene);
    return { cameraId: id, jpeg, simTimeMs: truth.simTimeMs, capturedAt, truth, encodeMs: performance.now() - started };
  }
}

export { OWNER_COLORS };
