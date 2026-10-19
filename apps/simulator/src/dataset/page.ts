/**
 * OFFLINE DATASET renderer page (dataset.html), driven by scripts/dataset/generate.mjs.
 *
 * Pixels come from the production capture path: Lab.captureFrame() renders cam-01 with
 * its own renderer and encodes that canvas as JPEG, exactly as for a streamed frame.
 * Labels are computed separately (labels.ts, raster.ts) and returned beside the JPEG.
 * This page never uploads anything: it has no API client and imports nothing from
 * src/stream (pinned by test/dataset.test.ts).
 */
import { Group, Scene } from 'three';
import calibration from '../../../../packages/shared/calibration/cam-01.json';
import { DEFAULT_POSE } from '../camera/pose.ts';
import { JPEG_QUALITY } from '../camera/virtualCamera.ts';
import { Lab } from '../lab.ts';
import { defaultSpec } from '../sim/spec.ts';
import type { DatasetConfig } from './config.ts';
import { cameraFor, occluderLabels, stageWorld, vehicleLabels } from './labels.ts';
import { buildOccluder } from './occluders.ts';
import { environmentOf, planDataset, type SamplePlan } from './plan.ts';
import { OCCLUSION_RULE, type Visibility, VisibilityRenderer } from './raster.ts';

const pose = DEFAULT_POSE;
if (JSON.stringify(pose) !== JSON.stringify(calibration.pose)) throw new Error('cam-01 default pose differs from calibration cam-01-fixed-v1');

const lab = new Lab(defaultSpec());
const scene = new Scene();
lab.attach(scene);
const camera = cameraFor(pose);
const live = lab.camera.camera;
if (!camera.projectionMatrix.equals(live.projectionMatrix) || !camera.matrixWorld.equals(live.matrixWorld))
  throw new Error('label camera does not match cam-01');

const polygons = Object.fromEntries(
  Object.entries(calibration.polygons as Record<string, { x: number; y: number }[]>).map(([id, pts]) => [
    id,
    pts.map((p) => [Math.round(p.x * pose.width * 100) / 100, Math.round(p.y * pose.height * 100) / 100]),
  ]),
);

function describe(sample: SamplePlan) {
  stageWorld(lab.world, sample, pose);
  const truth = lab.world.truth();
  return {
    environment: environmentOf(sample.preset),
    sim_time_ms: truth.simTimeMs,
    spaces: truth.spaces.map((s) => ({ space_id: s.space_id, truth: s.truth })),
    vehicles: vehicleLabels(lab.world, camera, pose),
    objects: occluderLabels(sample.occluders, camera, pose),
  };
}

const raster = new VisibilityRenderer(pose.width, pose.height);
/** Visibility depends on geometry only, not lighting, so presets of one layout share it. */
const rasterCache = new Map<string, { visibility: Visibility[]; stray_pixels: number }>();

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function render(sample: SamplePlan) {
  const logical = describe(sample);
  const occluders = new Group();
  occluders.name = 'dataset-occluders';
  for (const o of sample.occluders) occluders.add(buildOccluder(o));
  lab.root.add(occluders);
  try {
    const frame = await lab.captureFrame();
    if (JSON.stringify(frame.truth.spaces) !== JSON.stringify(logical.spaces)) throw new Error('capture truth differs from label truth');
    const [width, height] = lab.camera.resolution;
    const groups = (lab.root.getObjectByName('vehicles')?.children ?? []) as Group[];
    const ordered = lab.world.vehicles().map((v) => {
      const g = groups.find((m) => m.position.x === v.x && m.position.z === v.z && m.rotation.y === v.heading);
      if (!g) throw new Error(`no rendered mesh for ${v.key}`);
      return g;
    });
    const key = JSON.stringify([logical.vehicles.map((v) => [v.instance_id, v.world]), sample.occluders]);
    let measured = rasterCache.get(key);
    if (!measured) {
      measured = raster.measure(scene, camera, ordered);
      rasterCache.set(key, measured);
    }
    return { ...logical, width, height, jpeg_base64: await toBase64(frame.jpeg), visibility: measured.visibility, stray_pixels: measured.stray_pixels };
  } finally {
    lab.root.remove(occluders);
    occluders.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
  }
}

Object.assign(window, {
  __parkrightDataset: {
    plan: (config: DatasetConfig) => planDataset(config),
    describe,
    render,
    info: () => ({ calibration_version: calibration.version, camera_id: calibration.camera_id, pose, polygons, jpeg_quality: JPEG_QUALITY, occlusion_rule: OCCLUSION_RULE }),
  },
});
document.body.dataset.datasetReady = '1';
