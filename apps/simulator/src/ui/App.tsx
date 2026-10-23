import { useEffect, useState } from 'react';
import { PerceptionPanel } from './PerceptionPanel.tsx';
import { CameraFeedPanel } from './CameraFeedPanel.tsx';
import { CameraPosePanel } from './CameraPosePanel.tsx';
import { useLab, useVersion } from './context.ts';
import { FrameLog } from './FrameLog.tsx';
import { GroundTruthPanel } from './GroundTruthPanel.tsx';
import { OccupancyPanel } from './OccupancyPanel.tsx';
import { SimulationPanel } from './SimulationPanel.tsx';
import { type OverlayToggles, Viewport } from './Viewport.tsx';
import { decodeSpec, encodeSpec } from '../sim/spec.ts';
import { isDemoMode } from '../demo/demoMode.ts';

const TOGGLES: [keyof OverlayToggles, string][] = [
  ['labels', 'Space IDs'],
  ['outlines', 'Bay outlines'],
  ['truth', 'Ground truth'],
  ['frustum', 'cam-01 frustum'],
  ['stats', 'FPS'],
];

export function App() {
  const { lab, streamer } = useLab();
  useVersion(streamer);
  useVersion(lab.world);
  const [overlays, setOverlays] = useState<OverlayToggles>({ labels: true, outlines: false, truth: false, frustum: false, stats: false });

  // Keep the URL in step with the scene, so any view can be reproduced from its link.
  useEffect(() => {
    const hash = `#${encodeSpec(lab.world.spec)}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  });

  // Pasting a scene link (or editing the hash) loads that scene in a new stream session.
  useEffect(() => {
    const onHash = () => {
      if (location.hash === `#${encodeSpec(lab.world.spec)}`) return;
      lab.world.load(decodeSpec(location.hash));
      streamer.newSession();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [lab, streamer]);

  // Keyboard: space = play/pause, S = step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        lab.world.playing ? lab.world.pause() : lab.world.play();
      } else if (e.key === 's' || e.key === 'S') lab.world.step();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lab]);

  const api = streamer.api;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◩</span>
          <div>
            <h1>PARKRIGHT VISION LAB</h1>
            <p>Virtual infrastructure camera · garage-01 · Level L1 · 12 bays</p>
          </div>
        </div>
        <div className="top-status">
          {isDemoMode() && <span className="pill connected" data-testid="demo-badge"><i />DEMO MODE · FIXED SCENE</span>}
          <span className={`pill ${api}`} data-testid="api-status">
            <i />
            {api === 'connected' ? 'API CONNECTED' : api === 'disconnected' ? 'API DISCONNECTED' : 'API …'}
          </span>
          <span className="pill neutral">
            PERCEPTION&nbsp;<b>{streamer.health ? `${streamer.health.perception.provider}@${streamer.health.perception.version}` : '—'}</b>
          </span>
          <span className={`pill ${streamer.health?.evaluation_enabled ? 'connected' : 'neutral'}`}>EVALUATION {streamer.health?.evaluation_enabled ? 'ON' : 'OFF'}</span>
        </div>
      </header>

      <main className="workspace">
        <section className="stage">
          <div className="viewport">
            <Viewport overlays={overlays} />
            <div className="viewport-badge">OPERATOR VIEW · overlays never reach cam-01</div>
            <div className="toggles">
              {TOGGLES.map(([key, label]) => (
                <label key={key} className={overlays[key] ? 'on' : ''} data-testid={`overlay-${key}`}>
                  <input type="checkbox" checked={overlays[key]} onChange={(e) => setOverlays({ ...overlays, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <FrameLog />
        </section>

        <aside className="sidebar">
          <CameraFeedPanel />
          <PerceptionPanel />
          <SimulationPanel />
          <OccupancyPanel />
          <GroundTruthPanel />
          <CameraPosePanel />
        </aside>
      </main>
    </div>
  );
}
