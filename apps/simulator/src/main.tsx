import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from './lab.ts';
import { decodeSpec } from './sim/spec.ts';
import { FACILITY } from './sim/facility.ts';
import { BackendView } from './stream/backendView.ts';
import { FrameStreamer } from './stream/streamer.ts';
import { App } from './ui/App.tsx';
import { isDemoMode, startDemoMode } from './demo/demoMode.ts';
import { LabContext } from './ui/context.ts';
import './ui/styles.css';

// ?showcase=1&sim=garage: the 34-space showcase. ?sim=garage: the 12-space 3D garage. Otherwise the legacy Vision Lab, unchanged.
const params = new URLSearchParams(location.search);
if (params.get('sim') === 'garage' && params.get('showcase') === '1') {
  // 34-space multi-camera showcase.
  void import('./showcase/boot.tsx').then((m) => m.boot());
} else if (params.get('sim') === 'garage') {
  void import('./garage/boot.tsx').then((m) => m.boot());
} else {
  bootLegacy();
}

function bootLegacy() {
  const lab = new Lab(decodeSpec(location.hash));
  const streamer = new FrameStreamer(lab);
  const backend = new BackendView(FACILITY.facility_id);
  streamer.start();
  backend.start();
  if (isDemoMode()) startDemoMode(streamer);

  if (import.meta.env.DEV) Object.assign(window, { __visionLab: { lab, streamer, backend } });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LabContext.Provider value={{ lab, streamer, backend }}>
        <App />
      </LabContext.Provider>
    </StrictMode>,
  );
}
