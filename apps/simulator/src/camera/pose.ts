/**
 * cam-01's mounting: a fixed infrastructure camera on a pole at the south end of the
 * deck, looking north-down over both rows. Everything here is plain data so a batch
 * renderer can set the same pose without the UI.
 */
export interface CameraPose {
  /** Metres, world space. */
  position: [number, number, number];
  /** Degrees. yaw 0 looks north (−z); pitch < 0 looks down; roll about the view axis. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Vertical field of view, degrees. */
  fov: number;
  width: number;
  height: number;
}

export const RESOLUTIONS = [
  [640, 360],
  [960, 540],
  [1280, 720],
  [1920, 1080],
] as const;

export const DEFAULT_POSE: CameraPose = {
  position: [10, 10.5, 25.5],
  yaw: 0,
  pitch: -33,
  roll: 0,
  fov: 52,
  width: 1280,
  height: 720,
};

const DEG = Math.PI / 180;

/** Euler angles (radians, order YXZ) for a three.js camera with this pose. */
export function poseEuler(pose: CameraPose): [number, number, number] {
  return [pose.pitch * DEG, pose.yaw * DEG, pose.roll * DEG];
}

export function validPose(p: unknown): p is CameraPose {
  const v = p as CameraPose;
  return (
    !!v &&
    Array.isArray(v.position) &&
    v.position.length === 3 &&
    v.position.every(Number.isFinite) &&
    [v.yaw, v.pitch, v.roll, v.fov, v.width, v.height].every(Number.isFinite) &&
    v.fov > 5 &&
    v.fov < 150 &&
    RESOLUTIONS.some(([w, h]) => w === v.width && h === v.height)
  );
}
