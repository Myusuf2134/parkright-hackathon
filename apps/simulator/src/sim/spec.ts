/**
 * A SceneSpec fully determines what cam-01 sees when nothing is moving:
 *
 *   seed + occupancy (space → vehicle nonce) + environment preset + camera pose
 *
 * Vehicles are generated from (seed, space, nonce), so the spec never stores
 * geometry. Specs round-trip through the URL hash so a scene can be shared and
 * re-rendered later (and, eventually, batch-rendered for datasets).
 */
import { type CameraPose, DEFAULT_POSE, validPose } from '../camera/pose.ts';
import { SPACE_IDS } from './facility.ts';
import { isPresetId, type PresetId } from './presets.ts';

export interface SceneSpec {
  seed: number;
  preset: PresetId;
  /** Occupied bays and the nonce of the vehicle in each. Absent = empty. */
  occupancy: Record<string, number>;
  camera: CameraPose;
}

export const DEFAULT_SEED = 20261014;

export const defaultSpec = (): SceneSpec => ({ seed: DEFAULT_SEED, preset: 'clear_day', occupancy: {}, camera: { ...DEFAULT_POSE, position: [...DEFAULT_POSE.position] } });

export function normaliseSeed(value: number): number {
  return Number.isFinite(value) ? Math.abs(Math.trunc(value)) % 2 ** 31 : DEFAULT_SEED;
}

export function encodeSpec(spec: SceneSpec): string {
  const params = new URLSearchParams();
  params.set('seed', String(spec.seed));
  params.set('env', spec.preset);
  const occ = SPACE_IDS.filter((id) => id in spec.occupancy).map((id) => `${id}.${spec.occupancy[id]}`);
  params.set('occ', occ.join(','));
  const c = spec.camera;
  params.set('cam', [...c.position, c.yaw, c.pitch, c.roll, c.fov, c.width, c.height].map((n) => +n.toFixed(3)).join(','));
  return params.toString();
}

/** Parses what encodeSpec wrote; anything invalid falls back to the default for that part. */
export function decodeSpec(hash: string): SceneSpec {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const spec = defaultSpec();
  if (params.has('seed')) spec.seed = normaliseSeed(Number(params.get('seed')));
  const env = params.get('env');
  if (env && isPresetId(env)) spec.preset = env;
  for (const item of (params.get('occ') ?? '').split(',').filter(Boolean)) {
    const [id, nonce] = item.split('.');
    if (id && SPACE_IDS.includes(id) && /^\d+$/.test(nonce ?? '')) spec.occupancy[id] = Number(nonce);
  }
  const cam = (params.get('cam') ?? '').split(',').map(Number);
  if (cam.length === 9) {
    const [x, y, z, yaw, pitch, roll, fov, width, height] = cam as [number, number, number, number, number, number, number, number, number];
    const pose: CameraPose = { position: [x, y, z], yaw, pitch, roll, fov, width, height };
    if (validPose(pose)) spec.camera = pose;
  }
  return spec;
}
