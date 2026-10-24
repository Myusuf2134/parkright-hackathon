/** Boots the 3D garage simulator (?sim=garage). Loaded lazily, so the legacy lab never loads it. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isDemoMode, startDemoMode } from '../demo/demoMode.ts';
import { FrameStreamer } from '../stream/streamer.ts';
import '../ui/styles.css';
import { GarageApp } from './GarageApp.tsx';
import { GarageLab } from './lab.ts';
import { parseGaragePreset } from './presets.ts';
import { isScenarioId, type ScenarioId } from './scenarios.ts';

/** The demo fixture's scene in the garage: the static scenario (A1, A3, B2, B5 parked) in daylight. */
const DEMO_SCENARIO = 'static';
const DEMO_PRESET = 'clear_day';

export function boot(): void {
  const q = new URLSearchParams(location.search);
  const demo = isDemoMode();
  const scenario = demo ? DEMO_SCENARIO : isScenarioId(q.get('scenario') ?? '') ? (q.get('scenario') as ScenarioId) : 'static';
  const preset = demo ? DEMO_PRESET : parseGaragePreset(q.get('env')) ?? 'clear_day';
  const lab = new GarageLab(scenario, preset);
  if (q.has('t')) lab.world.setTime(Number(q.get('t')) || 0);
  if (q.get('play') === '1') lab.world.play();
  const streamer = new FrameStreamer(lab);
  streamer.start();
  if (demo) {
    startDemoMode(streamer, '', {
      matches: () => lab.world.spec.scenario === DEMO_SCENARIO && lab.world.spec.preset === DEMO_PRESET,
      load: () => {
        lab.load(DEMO_SCENARIO, DEMO_PRESET);
        streamer.newSession();
      },
    });
  }
  if (import.meta.env.DEV) Object.assign(window, { __garageLab: { lab, streamer } });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GarageApp lab={lab} streamer={streamer} />
    </StrictMode>,
  );
}
