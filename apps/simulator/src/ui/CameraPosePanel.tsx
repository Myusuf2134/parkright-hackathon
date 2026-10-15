import { type CameraPose, DEFAULT_POSE, RESOLUTIONS } from '../camera/pose.ts';
import { useLab, useVersion } from './context.ts';
import { Panel } from './Panel.tsx';

const SLIDERS: [string, (p: CameraPose) => number, (p: CameraPose, v: number) => CameraPose, number, number, number][] = [
  ['X', (p) => p.position[0], (p, v) => ({ ...p, position: [v, p.position[1], p.position[2]] }), -5, 25, 0.1],
  ['HEIGHT', (p) => p.position[1], (p, v) => ({ ...p, position: [p.position[0], v, p.position[2]] }), 3, 25, 0.1],
  ['Z', (p) => p.position[2], (p, v) => ({ ...p, position: [p.position[0], p.position[1], v] }), 15, 40, 0.1],
  ['YAW °', (p) => p.yaw, (p, v) => ({ ...p, yaw: v }), -60, 60, 0.5],
  ['PITCH °', (p) => p.pitch, (p, v) => ({ ...p, pitch: v }), -80, 0, 0.5],
  ['ROLL °', (p) => p.roll, (p, v) => ({ ...p, roll: v }), -15, 15, 0.5],
  ['FOV °', (p) => p.fov, (p, v) => ({ ...p, fov: v }), 25, 100, 0.5],
];

export function CameraPosePanel() {
  const { lab } = useLab();
  useVersion(lab.world);
  const pose = lab.world.spec.camera;
  return (
    <Panel title="CAM-01 MOUNT" tag={<span className="muted">fixed infrastructure camera</span>}>
      {SLIDERS.map(([label, get, set, min, max, step]) => (
        <label key={label} className="slider">
          <span>{label}</span>
          <input type="range" min={min} max={max} step={step} value={get(pose)} onChange={(e) => lab.world.setCamera(set(pose, Number(e.target.value)))} />
          <b className="mono">{get(pose).toFixed(1)}</b>
        </label>
      ))}
      <div className="row">
        <span className="label">RESOLUTION</span>
        <select
          value={`${pose.width}x${pose.height}`}
          onChange={(e) => {
            const [width, height] = e.target.value.split('x').map(Number) as [number, number];
            lab.world.setCamera({ ...pose, width, height });
          }}
          data-testid="resolution"
        >
          {RESOLUTIONS.map(([w, h]) => (
            <option key={w} value={`${w}x${h}`}>
              {w}×{h}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={() => lab.world.setCamera({ ...DEFAULT_POSE, position: [...DEFAULT_POSE.position] })}>
          Default mount
        </button>
      </div>
    </Panel>
  );
}
