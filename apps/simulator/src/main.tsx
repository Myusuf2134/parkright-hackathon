import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from './lab.ts';
import { decodeSpec } from './sim/spec.ts';
import { FACILITY } from './sim/facility.ts';
import { BackendView } from './stream/backendView.ts';
import { FrameStreamer } from './stream/streamer.ts';
import { App } from './ui/App.tsx';
import { LabContext } from './ui/context.ts';
import './ui/styles.css';

const lab = new Lab(decodeSpec(location.hash));
const streamer = new FrameStreamer(lab);
const backend = new BackendView(FACILITY.facility_id);
streamer.start();
backend.start();

if (import.meta.env.DEV) Object.assign(window, { __visionLab: { lab, streamer, backend } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LabContext.Provider value={{ lab, streamer, backend }}>
      <App />
    </LabContext.Provider>
  </StrictMode>,
);
